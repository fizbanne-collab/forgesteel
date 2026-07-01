# Integrating Forge Steel Upstream

The remotes are:

- `origin`: `fizbanne-collab/forgesteel`
- `upstream`: `andyaiken/forgesteel`
- `legacy-dsteelweb`: the repository that previously occupied this workspace

Keep StravSteel work on feature branches and integrate upstream through a
dedicated branch:

```sh
git fetch upstream
git switch main
git merge --ff-only origin/main
git switch -c upstream/forge-steel-YYYY-MM-DD
git merge upstream/main
```

Resolve and test conflicts on the integration branch, then merge it through a
reviewed pull request. Avoid embedding StravSteel server behavior throughout
upstream UI components; prefer the storage service and routing seams described
in `architecture.md`.
