# Runbook

## Starting Local Factory

```powershell
npm start
```

Default URL: `http://127.0.0.1:3010`

## Using Project Hub

1. Open Project Hub from the administrator sidebar.
2. Register each project directory inside the current workspace.
3. Create one or more Agents for each project.
4. Give each Agent a narrow testing objective.
5. Start one Agent or all enabled Agents.
6. Review findings and handoffs before creating implementation tasks.

## Recovery

- A server restart marks unfinished Agent runs as interrupted.
- Interrupted Agent runs are not resumed automatically.
- Video generation and publishing queues are not controlled by Project Hub.
- Runtime Project Hub data is stored under the configured `work/project-hub/` directory.
