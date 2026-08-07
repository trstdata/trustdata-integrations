# Agent skills

Skills teach an AI agent how to work with TrustData. They install into the
agent, not into your infrastructure, so this directory has no deploy target.

| Skill | What it covers |
|---|---|
| [`trustdata/`](./trustdata) | Which MCP tool answers which question, and how to read the results without misreporting them |

Install with the plugin (skill and MCP server together, no token to paste):

```
claude plugin marketplace add trstdata/trustdata-integrations
claude plugin install trustdata@trustdata
```

Or the skill alone, for agents without plugin support:

```
npx -y skills add trstdata/trustdata-integrations --skill trustdata --yes
```

The source of truth is the TrustData platform repo. This copy is mirrored on
every change, and a test there fails when the skill names an MCP tool that no
longer exists. Send corrections as issues rather than pull requests against
this file.
