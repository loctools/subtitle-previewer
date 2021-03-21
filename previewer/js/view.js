var hashQuery;
var rawHashQuery;
var prevRawHashQuery;

var autoplayRequested = false;
var videoLoaded = false;
var wasInitialized = false;

var jsonpData;

var timeline = [];
var lastTimelineIdx = -1;

var highlightedCues = {};
var minHighlightedCueIdx = -1;

var currentCueIndex = -1;
var lastSelectedCueIndex = -1;
var loopStart = -1;
var loopEnd = -1;
var adjustedVideoDuration = -1;
var isEmptyVideo = false;

var videoPlaybackMonitorTimer;

var hostWindow = window.opener || window.parent || window;

// add extra small value to make sure we go to the actual cue
// we clicked on, and not to the upper one, when upper one
// ends at the same time as the next one begins.
const TINY_TIME_OFFSET = 0.0001;

document.addEventListener('DOMContentLoaded', onDocumentLoad);
document.addEventListener('keydown', onDocumentKeydown);
document.addEventListener('mousemove', onDocumentMouseMove);
window.onhashchange = onWindowHashChange;
window.addEventListener('message', onWindowMessage, false);

function onDocumentLoad() {
    console.log('onDocumentLoad()');

    if (window.location.hash === '') {
        console.warn('Path not provided');
    } else {
        onWindowHashChange();
    }

    // tell the parent that that it's a smart preview window
    // capable of exchaning messages

    hostWindow.postMessage({
        navigationHandled: true,
        url: window.location.href,
    }, '*');
}

function onWindowHashChange() {
    parseHashQuery();

    if (prevRawHashQuery === rawHashQuery) {
        return;
    }
    console.log('onWindowHashChange()', window.location.hash);

    if (prevRawHashQuery !== rawHashQuery) {
        prevRawHashQuery = rawHashQuery;
        if (renderView()) {
            return;
        }
    }

    clearLoop();
    pause();

    prevRawHashQuery = rawHashQuery;
    renderState();
}

function onWindowMessage(e) {
    if (!e.data) {
        return;
    }
    console.log('onWindowMessage', 'data:', e.data);

    if (e.data.navigate) {
        // Posting the "navigation handled" event back
        // to prevent hard redirect
        e.source.postMessage({
            navigationHandled: true,
            url: e.data.url,
        }, '*');
        history.replaceState(undefined, undefined, e.data.url);
        onWindowHashChange();
        return;
    }

    /*
    if (e.data.change) {
        let id = e.data.id;
        let value = e.data.value;
        let el = getSegmentElementById(id);
        if (!el) {
            return;
        }
        el.innerText = value; // or innerHTML, depending on the internal knowledge
        return;
    }
    */
}


function renderView() {
    console.log('renderView()');

    videoLoaded = false;
    jsonpData = undefined;
    wasInitialized = false;
    removeCueSelection();
    lastSelectedCueIndex = -1;
    loopStart = -1;
    loopEnd = -1;

    autoplayRequested = hashQuery['play'];
    jsonpUrl = encodeURI(hashQuery['jsonp']);
    console.log('hashQuery:', hashQuery);
    if (document.getElementById('jsonp').src === jsonpUrl) {
        return false;
    }
    console.log('Current src:', document.getElementById('jsonp').src); // URLencoded
    console.log('Loading JSONP data from', jsonpUrl);
    document.getElementById('jsonp').src = jsonpUrl;
    return true;
}

function renderState() {
    console.log('renderState()');
    var textTrack = video.textTracks[0];
    parseHighlightInfo(textTrack.cues.length);

    for (var i = 0; i < textTrack.cues.length; i++) {
        var cue = textTrack.cues[i];

        cue.__outerDiv.classList.toggle('highlighted', !!highlightedCues[i]);
    }

    autoplayRequested = hashQuery['play'];
    initializeVideoPosition();
}

function parseHashQuery() {
    rawHashQuery = window.location.hash.substr(1);
    hashQuery = parseQueryParams(rawHashQuery);
    console.log('rawHashQuery:', rawHashQuery);
    console.log('hashQuery:', hashQuery);
}

function updateHighlightInfoInUrl() {
    console.log('updateHighlightInfoInUrl()', 'highlightedCues:', highlightedCues);
    parts = [];
    begin = -1;
    end = -1;
    for (var i in highlightedCues) {
        i *= 1; // convert to a number
        if (begin === -1) {
            begin = i;
            end = i;
            continue;
        }
        if (i === end + 1) {
            end = i;
            continue;
        }
        if (begin === end) {
            parts.push(begin + 1);
        } else {
            parts.push([begin + 1, end + 1].join('-'));
        }
        begin = i;
        end = i;
    }
    console.log('after loop:', 'begin:', begin, 'end:', end);
    if (begin !== -1) {
        if (begin === end) {
            parts.push(begin + 1);
        } else {
            parts.push([begin + 1, end + 1].join('-'));
        }
    }
    var s = parts.join(';');
    console.log('hl=' + s);

    if (s === '') {
        delete hashQuery.hl;
    } else {
        hashQuery.hl = s;
    }

    updateHash();
}

function updateHash() {
    var q = buildQueryParams(hashQuery);
    prevRawHashQuery = q;
    window.location.hash = '#' + q;
}

/* entry point for the data loaded via JSONP */
function jsonp(data) {
    if (data === '') {
        console.warn('Empty response received');
        return;
    }
    console.warn('JSONP data:', data);

    if (data.mediaUrl) {
        console.log('Setting an explicitly specified media URL');
        setVideoUrl(data.mediaUrl);
        document.body.classList.remove('emptyvideo');
    } else {
        console.log('Setting an empty video');
        isEmptyVideo = true;
        setVideoUrl('img/empty.mp4');
        document.body.classList.add('emptyvideo');
    }

    jsonpData = data;
    checkIfDataLoadedAndInitCues();
}

function setVideoUrl(url) {
    video.src = url;
    console.log('Requested the video to load');
    video.load();
}

function updateVideoPositionTimestamp() {
    timeStamp.innerText = formatTimestamp(video.currentTime);
}

function updateVideoPositionLine() {
    if (video.textTracks.length === 0) {
        return;
    }
    var cues = video.textTracks[0].cues;
    var t = video.currentTime;

    var seekStartIdx = 0;
    if (lastSelectedCueIndex > -1) {
        seekStartIdx = cues[lastSelectedCueIndex].__timelineIdx;
    }
    if (t < cues[0].startTime) {
        seekStartIdx = 0;
    }

    for (var i = seekStartIdx; i < timeline.length; i++) {
        var ti = timeline[i];
        if (ti.from <= t && ti.till >= t) {
            if (lastTimelineIdx != i) {
                if (ti.fromDiv) {
                    ti.fromY = ti.fromDiv.offsetTop;
                } else {
                    ti.fromY = 0;
                }

                if (ti.tillDiv) {
                    ti.tillY = ti.tillDiv.offsetTop;
                } else {
                    ti.tillY = scrollableList.scrollHeight;
                }
            }

            var relPos = (t - ti.from) / (ti.till - ti.from);
            var y = Math.round(relPos * (ti.tillY - ti.fromY) + ti.fromY);

            videoPositionLine.style.top = y + 'px';
            scrollableList.scrollTop = y - 120; // to see one previous cue above + a bit extra

            lastTimelineIdx = i;
            return;
        }
    }
}

function requestUIUpdate() {
    window.requestAnimationFrame(updateUI);
}

function updateUI() {
    updateVideoPositionTimestamp();
    updateVideoPositionLine();
}

video.addEventListener('loadeddata', function () {
    console.log('video.loadeddata');
    videoLoaded = true;
    requestUIUpdate();
    checkIfDataLoadedAndInitCues();
});

function checkIfDataLoadedAndInitCues() {
    if (videoLoaded && jsonpData && !wasInitialized) {
        buildCues();
        initCues();
        buildTimeline();
        initializeVideoPosition();
    }
}

function initializeVideoPosition() {
    if (hashQuery['st'] !== undefined) {
        disableMouseHover();
        video.currentTime = hashQuery['st'];
    } else if (minHighlightedCueIdx > -1) {
        disableMouseHover();
        gotoCue(minHighlightedCueIdx);
    } else {
        // just update the UI
        // to select the active cue, if any
        textTrackCueChange();
    }
}

video.addEventListener('timeupdate', videoPlaybackMonitor, true);

video.addEventListener(
    'pause',
    function (e) {
        document.body.classList.remove('isPlaying');
    },
    true
);

video.addEventListener(
    'play',
    function (e) {
        document.body.classList.add('isPlaying');
    },
    true
);

function play() {
    if (!video.paused) {
        return;
    }

    videoPlaybackMonitorTimer = setInterval(videoPlaybackMonitor, 20);

    var promise = video.play();

    console.log('Playback requested');

    if (promise !== undefined) {
        promise
            .then((_) => {
                console.log('Playback started');
            })
            .catch((error) => {
                console.log('Playback failed');
                console.error(error);
            });
    }
}

function pause() {
    if (video.paused) {
        return;
    }

    console.log('Video paused');

    clearInterval(videoPlaybackMonitorTimer);
    video.pause();
}

var lastUIVideoPosition = -1;
function videoPlaybackMonitor() {
    var t = video.currentTime;
    if (t === lastUIVideoPosition) {
        return;
    }

    requestUIUpdate();
    lastUIVideoPosition = t;

    if (video.paused) {
        return;
    }

    if (isEmptyVideo && t > adjustedVideoDuration) {
        pause();
        video.currentTime = adjustedVideoDuration;
        return;
    }

    if (loopEnd > -1 && t >= loopEnd) {
        pause();
        video.currentTime = loopStart + TINY_TIME_OFFSET;
        clearLoop();
    }
}

playPause.addEventListener('click', togglePlayPause);

function togglePlayPause() {
    if (video.paused) {
        play();
    } else {
        pause();
    }
}

function parseHighlightInfo(maxCues) {
    minHighlightedCueIdx = -1;

    highlightedCues = {};
    if (hashQuery['hl'] === undefined) {
        return;
    }

    hashQuery['hl'].split(';').forEach((range) => {
        var parts = range.split('-');
        var start = parts[0];
        var end = parts.length == 1 ? parts[0] : parts[1];
        start *= 1; // convert to number
        end *= 1; // convert to number

        if (start < 1 || start > end || start > maxCues || end > maxCues) {
            return;
        }

        for (var i = start; i <= end; i++) {
            highlightedCues[i - 1] = true;

            if (minHighlightedCueIdx === -1 || i < minHighlightedCueIdx) {
                minHighlightedCueIdx = i - 1;
            }
        }
    });
    console.log('highlightedCues:', highlightedCues);
}

function updateSpeedLabel(cue, div) {
    // calculate speed in chars per second
    var duration = cue.endTime - cue.startTime;
    var speed = cue.text.length / duration;
    var normalSpeed = 20; // chars per second
    var relSpeed = speed / normalSpeed; // < 1 = slower; > 1 = faster than norm
    var minSpeed = 0.5;
    var maxSpeed = 2;
    // trim to [minSpeed, maxSpeed]
    if (relSpeed < minSpeed) {
        relSpeed = minSpeed;
    }
    if (relSpeed > maxSpeed) {
        relSpeed = maxSpeed;
    }

    // if the absolute time cue is shown is less
    // than a second, map the maximum speed
    // as a function between
    if (duration < 1) {
        if (duration <= 0.5) {
            relSpeed = maxSpeed;
        } else {
            // map (0.5..1] (duration) to (2..1.5) (rel. speed)
            relSpeed = 2.5 - duration;
        }
    }

    // convert to a value of hue:
    // [minSpeed..1] => 255-127 (blue to green)
    // (1..maxSpeed] => 127-0 (green to red)
    var hue;
    if (relSpeed <= 1) {
        // [0.5..1]
        hue = 1 - relSpeed; // [0.5..0]
        hue += minSpeed; // [1..0.5]
        hue = Math.round(hue * 255); // [255..127]
    } else {
        // (1..2]
        hue = 2 - relSpeed; // (1..0]
        hue = Math.round(hue * 127); // (127..0]
    }
    var hsl = 'hsl(' + hue + ', 100%, 50%)';

    div.style.background = hsl;
    div.innerText = Math.round(speed) + 'cps';
}

function prepareTextTrack() {
    if (video.textTracks.length === 0) {
        var textTrack = video.addTextTrack('subtitles');
        textTrack.addEventListener('cuechange', textTrackCueChange);
        return textTrack;
    }

    var textTrack = video.textTracks[0];
    while (textTrack.cues.length > 0) {
        textTrack.removeCue(textTrack.cues[0]);
    }

    return textTrack;
}

function buildCues() {
    console.log('buildCues()');

    var track = prepareTextTrack();

    for (var i = 0; i < jsonpData.cues.length; i++) {
        var meta = jsonpData.cues[i];
        var cue = new VTTCue(meta.from / 1000, meta.till / 1000, meta.text);
        track.addCue(cue);
    }

    track.mode = 'showing';
}

function initCues() {
    console.log('initCues()');
    wasInitialized = true;
    var textTrack = video.textTracks[0];

    // now that we know the total length of the cues list,
    // parse the highlighting info

    parseHighlightInfo(textTrack.cues.length);

    // add index back to each cue object
    // for cross-referencing

    for (var i = 0; i < textTrack.cues.length; i++) {
        textTrack.cues[i].__index = i;
    }

    // render the cues

    scrollableListItems.innerText = '';

    for (var i = 0; i < textTrack.cues.length; i++) {
        var cue = textTrack.cues[i];

        var outerDiv = document.createElement('div');
        cue.__outerDiv = outerDiv;

        var div = document.createElement('div');
        div.className = 'startTime';
        div.innerText = formatTimestamp(cue.startTime);
        outerDiv.appendChild(div);
        cue.__startDiv = div;

        var div = document.createElement('div');
        div.className = 'endTime';
        div.innerText = formatTimestamp(cue.endTime);
        outerDiv.appendChild(div);
        cue.__endDiv = div;

        var div = document.createElement('div');
        div.className = 'speed';
        updateSpeedLabel(cue, div);
        outerDiv.appendChild(div);
        cue.__speedDiv = div;

        var div = document.createElement('div');
        div.className = 'cue';
        div.innerText = cue.text;
        outerDiv.appendChild(div);

        scrollableListItems.appendChild(outerDiv);

        outerDiv.__index = i;

        if (highlightedCues[i]) {
            outerDiv.classList.add('highlighted');
        }

        outerDiv.addEventListener('click', onCueMouseClick);
    }

    adjustGeometry();

    adjustedVideoDuration = video.duration;
    if (isEmptyVideo) {
        var lastIdx = textTrack.cues.length - 1;
        adjustedVideoDuration = textTrack.cues[lastIdx].endTime + 1; // 1 second past last cue
    }

    videoLength.innerText = formatTimestamp(adjustedVideoDuration);
}

function buildTimeline() {
    timeline = [];

    var textTrack = video.textTracks[0];
    var timelineIdx = -1;

    var firstCue = textTrack.cues[0];
    var lastCue = textTrack.cues[textTrack.cues.length - 1];
    var cuesStart = firstCue.startTime;

    if (cuesStart > 0) {
        timeline[++timelineIdx] = {
            from: 0,
            till: cuesStart,
            fromDiv: null,
            tillDiv: firstCue.__outerDiv,
        };
    }

    for (var i = 0; i < textTrack.cues.length - 1; i++) {
        cue = textTrack.cues[i];
        nextCue = textTrack.cues[i + 1];
        timeline[++timelineIdx] = {
            from: cue.startTime,
            till: nextCue.startTime,
            fromDiv: cue.__outerDiv,
            tillDiv: nextCue.__outerDiv,
        };
        // add reference from the cue to the timeline index
        // for easier seeking
        cue.__timelineIdx = timelineIdx;
    }

    timeline[++timelineIdx] = {
        from: lastCue.startTime,
        till: lastCue.endTime,
        fromDiv: lastCue.__outerDiv,
        tillDiv: scrollableListFooter,
    };
    lastCue.__timelineIdx = timelineIdx;

    if (lastCue.endTime < adjustedVideoDuration) {
        timeline[++timelineIdx] = {
            from: lastCue.endTime,
            till: adjustedVideoDuration,
            fromDiv: scrollableListFooter,
            tillDiv: null,
        };
    }
}

function adjustGeometry() {
    adjustScrollableListGeometry();

    // adjust the height of the list footer
    // to allow to scroll up to the last cue only

    var h = scrollableListContainer.offsetHeight - scrollableListItems.lastChild.offsetHeight;
    scrollableListFooter.style.height = h + 'px';
}

function removeCueSelection() {
    if (currentCueIndex != -1) {
        var div = scrollableListItems.children[currentCueIndex];
        div.classList.remove('selected');
        currentCueIndex = -1;
    }
}

function selectCueByIndex(index) {
    console.log('selectCueByIndex()', 'index:', index, 'currentCueIndex:', currentCueIndex);
    removeCueSelection();

    if (index === -1) {
        return;
    }

    var div = scrollableListItems.children[index];
    disableMouseHover();

    div.classList.add('selected');

    currentCueIndex = index;
    lastSelectedCueIndex = index;
}

function gotoCue(index) {
    var textTrack = video.textTracks[0];
    var cue = textTrack.cues[index];
    video.currentTime = cue.startTime + TINY_TIME_OFFSET;
}

function textTrackCueChange() {
    var textTrack = video.textTracks[0];
    var cue = textTrack.activeCues[0];
    var idx = cue ? cue.__index : -1;

    console.log('textTrackCueChange()', 'idx:', idx, 'video.currentTime:', video.currentTime);

    selectCueByIndex(idx);

    if (autoplayRequested) {
        if (video.paused) {
            setLoop(true);
            play();
        }
        autoplayRequested = false;
    }
}

function onCueMouseClick(e) {
    console.log('onCueMouseClick()', 'metaKey:', e.metaKey);

    var textTrack = video.textTracks[0];
    var cue = textTrack.cues[this.__index];

    if (e.metaKey) {
        var prevState = highlightedCues[this.__index];

        // if Shift key is also pressed, remove all the previous selection,
        // unless we already have just one item that needs to be toggled
        if (!e.shiftKey && Object.keys(highlightedCues).length > 0) {
            for (var i in highlightedCues) {
                i *= 1; // convert to a number
                if (i === this.__index) {
                    continue;
                }
                textTrack.cues[i].__outerDiv.classList.remove('highlighted');
            }
            highlightedCues = [];
        }
        e.preventDefault();

        if (prevState) {
            delete highlightedCues[this.__index];
        } else {
            highlightedCues[this.__index] = true;
        }
        updateHighlightInfoInUrl();
        this.classList.toggle('highlighted', highlightedCues[this.__index]);

        return;
    }

    clearLoop();

    var targetTime = cue.startTime + TINY_TIME_OFFSET;

    delta = Math.abs(targetTime - video.currentTime);
    if (video.paused && delta < TINY_TIME_OFFSET) {
        play();
        return;
    }

    video.currentTime = targetTime;

    if (!video.paused) {
        pause();
    }
}

function parseTime(t) {
    var h = 0;
    var m = 0;
    var s = Math.floor(t);
    var ms = Math.floor(t * 1000) % 1000;
    if (s > 60) {
        m = Math.floor(s / 60);
        s = s % 60;
    }
    if (m > 60) {
        h = Math.floor(m / 60);
        m = m % 60;
    }

    return { h, m, s, ms };
}

function formatFullTimestampParts({ h, m, s, ms }) {
    h = h < 10 ? '0' + h : h;
    m = m < 10 ? '0' + m : m;
    s = s < 10 ? '0' + s : s;
    ms = ms < 10 ? '00' + ms : ms < 100 ? '0' + ms : ms;
    return h + ':' + m + ':' + s + '.' + ms;
}

function formatShortTimestampParts({ h, m, s, ms }) {
    h = h < 10 ? '0' + h : h;
    m = m < 10 ? '0' + m : m;
    s = s < 10 ? '0' + s : s;
    ms = ms < 10 ? '00' + ms : ms < 100 ? '0' + ms : ms;

    if (h === '00') {
        return m + ':' + s + '.' + ms;
    }
    return h + ':' + m + ':' + s + '.' + ms;
}

function formatTimestamp(t) {
    return formatShortTimestampParts(parseTime(t));
}

function onDocumentKeydown(e) {
    if (processKeydownEvent(e)) {
        e.preventDefault();
    }
}

function setLoop(extendForSelection) {
    console.log('setLoop(' + extendForSelection + ')');
    var textTrack = video.textTracks[0];
    if (currentCueIndex === -1) {
        currentCueIndex = 0;
    }
    var cue = textTrack.cues[currentCueIndex];
    loopStart = cue.startTime;
    loopEnd = cue.endTime;
    console.log('loopEnd:', loopEnd);

    if (extendForSelection) {
        for (var i = currentCueIndex; i < textTrack.cues.length; i++) {
            if (!highlightedCues[i]) {
                break;
            }
            loopEnd = textTrack.cues[i].endTime;
            console.log('extending loopEnd to', loopEnd);
        }
    }
}

function clearLoop() {
    console.log('clearLoop()');
    loopStart = loopEnd = -1;
}

function processKeydownEvent(e) {
    var textTrack = video.textTracks[0];
    var cue = currentCueIndex > -1 ? textTrack.cues[currentCueIndex] : undefined;

    disableMouseHover();

    if (e.code === 'ArrowLeft') {
        clearLoop();
        if (e.altKey) {
            video.currentTime -= 0.1;
            return true;
        }
        if (e.shiftKey) {
            video.currentTime -= 10;
            return true;
        }
        video.currentTime -= 1;
        return true;
    }
    if (e.code === 'ArrowRight') {
        clearLoop();
        if (e.altKey) {
            video.currentTime += 0.1;
            return true;
        }
        if (e.shiftKey) {
            video.currentTime += 10;
            return true;
        }
        video.currentTime += 1;
        return true;
    }
    if (e.code === 'ArrowUp') {
        clearLoop();
        if (cue && video.currentTime - TINY_TIME_OFFSET > cue.startTime + 0.5) {
            gotoCue(currentCueIndex);
            return true;
        }
        if (lastSelectedCueIndex > 0) {
            gotoCue(lastSelectedCueIndex - 1);
        }
        return true;
    }
    if (e.code === 'ArrowDown') {
        clearLoop();
        if (lastSelectedCueIndex < textTrack.cues.length - 1) {
            gotoCue(lastSelectedCueIndex + 1);
        }
        return true;
    }
    if (e.code === 'Space') {
        togglePlayPause();
        return true;
    }
    if (e.code === 'Escape') {
        clearLoop();
        if (!video.paused) {
            pause();
        }
        return true;
    }

    if (e.code === 'Enter') {
        setLoop(!e.shiftKey);
        gotoCue(currentCueIndex);
        play();
        return true;
    }

    // all rules below work only when there's
    // a cue selected

    if (currentCueIndex === -1) {
        return false;
    }

    // edit mode keys

    if (e.code === 'KeyQ') {
        cue.startTime -= 0.1;
        cue.__startDiv.innerText = formatTimestamp(cue.startTime);
        updateSpeedLabel(cue, cue.__speedDiv);
        return true;
    }

    if (e.code === 'KeyW') {
        cue.startTime += 0.1;
        cue.__startDiv.innerText = formatTimestamp(cue.startTime);
        updateSpeedLabel(cue, cue.__speedDiv);
        return true;
    }

    if (e.code === 'KeyZ') {
        cue.endTime -= 0.1;
        cue.__endDiv.innerText = formatTimestamp(cue.endTime);
        updateSpeedLabel(cue, cue.__speedDiv);
        return true;
    }

    if (e.code === 'KeyX') {
        cue.endTime += 0.1;
        cue.__endDiv.innerText = formatTimestamp(cue.endTime);
        updateSpeedLabel(cue, cue.__speedDiv);
        return true;
    }

    return false;
}

var isNoHoverMode = false;

function disableMouseHover() {
    if (isNoHoverMode) {
        return;
    }
    console.log('disableMouseHover()');
    isNoHoverMode = true;
    document.body.classList.add('noHover');
}

function enableMouseHover() {
    if (!isNoHoverMode) {
        return;
    }
    isNoHoverMode = false;
    console.log('enableMouseHover()');
    document.body.classList.remove('noHover');
}

function onDocumentMouseMove() {
    if (isNoHoverMode) {
        enableMouseHover();
    }
}
