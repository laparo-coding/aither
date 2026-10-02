# Codacy Configuration

## Files

| File | VCS | Purpose |
|------|-----|---------|
| `codacy.config.json` | **committed** | Minimal local config: Biome via `biome.json` (`useLocalConfigurationFile: true`), empty pattern list. Used by CI (`.codacy/cli.sh` analyze step). |
| `codacy.config.baseline.json` | **gitignored** | Auto-generated remote baseline (~186 KB). Contains org/repository IDs and the full baseline'd pattern list. Regenerated locally by the Codacy CLI on demand. |
| `codacy.yaml` | committed | Codacy cloud configuration. |
| `cli.sh` | committed | Codacy CLI bootstrap script (used by CI Trivy step). |

## Why the baseline is not committed

1. **Size/churn**: ~186 KB, 4897 lines, auto-regenerated with fresh timestamps on
   every CLI sync — noisy diffs, inflated repo.
2. **Metadata disclosure**: embeds `organization`, `repositoryId`, and the
   complete list of baseline'd security patterns. The repo is public.
3. **No consumer**: neither `cli.sh` nor CI reference the baseline.

## Regeneration strategy

The baseline is regenerated automatically when the Codacy CLI needs it:

```bash
# Via MCP tool (codacy_cli_analyze) or CLI directly:
./.codacy/cli.sh analyze
```

If the CLI overwrites `codacy.config.json` with a remote snapshot (source:
"remote", filled metadata), restore the minimal local config:

```bash
git checkout -- .codacy/codacy.config.json
```

Rule of thumb: `codacy.config.json` stays minimal and local-sourced
(`"source": "local"`, null org/repo fields). Never commit the remote snapshot.
