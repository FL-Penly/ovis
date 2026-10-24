### Fixed
- Each plugin start keeps the run before it as `server.log.1` and begins a new `server.log`,
  instead of appending every run to one file that grows forever. While the recorded server is
  still running, the start appends to its log as before.
- A failed plugin start reads only the last 64 KiB of `server.log` for the lines it shows, so a
  large log no longer costs memory.
