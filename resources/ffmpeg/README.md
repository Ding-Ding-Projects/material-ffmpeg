# Bundled FFmpeg runtime

`download-dependencies.bat` materializes the pinned FFmpeg 9.0.1 Windows x64 runtime here from the exact URL and SHA-256 in `dependencies.json`.

The generated directory contains only the required `ffmpeg.exe`, `ffprobe.exe`, and upstream license/build-information files. Generated binaries are intentionally excluded from Git and are packaged into the installed application under `resources/ffmpeg/`.
