# A shell for the classic typewriter

The classic typewriter prints program output one character at a time. A framework prompt is a bad
match: Powerlevel10k redraws a full line of segments, a `·` filler and a right-hand clock on every
command, so the machine spends seconds striking decoration — and every redraw leaves a stain on the
paper (by design).

This directory holds a minimal zsh setup: a one-line prompt, history, emacs keys, no framework and no
completion menu. Point a profile at it and open that profile in a new tab:

```json
{
  "config": {
    "profiles": [
      { "name": "default", "config": {} },
      {
        "name": "classic",
        "config": {
          "shell": "/bin/zsh",
          "shellArgs": ["-i"],
          "env": { "ZDOTDIR": "/absolute/path/to/extras/classic-shell" }
        }
      }
    ]
  }
}
```

`ZDOTDIR` also moves `.zshenv`, `.zprofile` and `.zlogin`, so none of your login files are read in
this profile; the settings are exactly what `zshrc` says. Set `"defaultProfile": "classic"` to make
new tabs open this shell, and pick `default` from the new-tab dropdown when you want your own.

Prefer bash instead? `"shell": "/bin/bash", "shellArgs": ["--norc", "-i"]` and a `PS1` in the
profile's `env` is enough; the principle is the same: short prompt, no completion menu.
