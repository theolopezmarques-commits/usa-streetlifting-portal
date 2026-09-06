## Brain Vault (Memory)
Past sessions, decisions, and context for this project are stored in ~/Desktop/brain/.

At the start of every session, automatically run:
```
cd ~/Desktop/brain && source $HOME/.local/bin/env && graphify query "usa streetlifting"
```
Read whatever the graph returns before starting work. This replaces re-explaining past decisions.

At the end of sessions: user will type /remember — write a structured note to ~/Desktop/brain/00-inbox/.

## Project
- Stack: Node.js + Express + SQLite
- Working dir: ~/Downloads/usa-streetlifting/
- Live: **usastreetliftingjudging.org** (old v1 judge-certification portal, Railway service `usa-streetlifting-portal`). NOT usastreetlifting.org — the main site runs the v2 codebase at ~/Desktop/usa-streetlifting-v2. When Theo says "usastreetlifting" or "the website" he almost always means usastreetlifting.org / v2.
