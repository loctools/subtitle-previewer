# Subtitle Previewer

This is a subtitle previewer application that works directly in the browser (it doesn't require any server-side component), and is meant to be used as an in-context previewer when editing subtitles inside a CAT tool.

# Installation

You can host it anywhere (on S3, or as a static Github page). Just publish the contents of the `previewer` folder somewhere where it can be accessed by a public URL.

# Usage

Provided you have published the Subtitle Prevewer under `https://example.com/previewer` URL, you can run it as follows:

    https://example.com/previewer/index.html#jsonp={JSONP_URL}[&hl={N}][&play]

where

- `JSONP_URL` is a URL of a subtitle file in a special format (see below), which can be hosted anywhere.
- `hl={N}` is an optional parameter, where `N` is the index of a cue to highlight and navigate to.
- `play` is an optional parameter, which instructs the highlighted cue to auto-play upon loading.

# JSONP Subtitle Data Format

This is a special format that allows one to reference the cue data across domains. It contains of a `jsonp( ... );` wrapper function with some JSON data inside. `cues` is an array of cues, and `mediaUrl` is a URL of a media file to be rendered. It can be a video file (`.mp4`) or an audio file (`.mp4`). If not provided, a blank video will be used. Each cue has `from` and `till` timestamps encoded as offsets from the beginning of the track, in milliseconds. `text` is what is being displayed on top of the video.

```javascript
jsonp(
{
   "mediaUrl" : "https://static.storage.site/path/to/video.mp4",
   "cues" : [
      {
         "from" : 4035,
         "text" : "Text of the first cue",
         "till" : 9099
      },
      {
         "from" : 10043,
         "text" : "Text of the second cue",
         "till" : 12062
      },
      ...
   ]
}
);
```

# Questions / Comments?

Join the chat in Gitter: https://gitter.im/loctools/community
