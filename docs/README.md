@"

# ObsidianLM

ObsidianLM is a lightweight local AI runtime manager.

The first target runtime is `llama.cpp` / `llama-server.exe`.

Its goal is to provide a clean control plane for starting, stopping, configuring, monitoring, and switching local AI runtimes while external tools like OpenCode and Illustria communicate with the runtime directly.

## Project Plan

See [docs/project-plan.md](docs/project-plan.md).
"@ | Set-Content .\README.md -Encoding UTF8
