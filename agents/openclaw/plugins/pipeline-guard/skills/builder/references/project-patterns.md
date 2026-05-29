# Project Codebase Patterns

Conventions to follow when writing code for this project. **Replace the
examples below with your project's actual conventions** — this file is a
template. The goal is to give the builder a single place to learn how *this*
codebase does things so new code matches existing code.

## LLM Calls

Route every LLM call through one shared helper module instead of calling the
provider SDK directly from each script. This centralizes timeouts, retries,
auth, and response parsing.

```python
from lib.llm import llm_chat

response = llm_chat(
    messages=[{"role": "user", "content": prompt}],
    max_tokens=8192,
    temperature=0.3,
)
```

Always check the actual function signatures in the helper module before
calling — they may have changed.

## Database Access

Always use parameterized queries — never string-format user or runtime data
into SQL/Cypher.

```python
# Parameterized (correct)
cur.execute("SELECT * FROM items WHERE id = %s", (item_id,))

# String-formatted (forbidden — injection risk)
cur.execute(f"SELECT * FROM items WHERE id = {item_id}")  # NO
```

- Open connections through the shared `lib.db` helpers, not ad-hoc per script.
- Commit writes explicitly; close cursors and connections when done.
- For graph stores, use idempotent writes (`MERGE`) and parameterized queries.

## Error Handling

```python
try:
    result = some_external_call()
except Exception as e:
    logger.error("call failed: %s", e)
    return None  # structured fallback, don't crash the pipeline
```

- Log the actual exception message, not "something went wrong".
- Return structured fallbacks (None, empty list) rather than letting one
  failure abort a batch — unless the caller needs the failure to propagate.
- For retryable failures, use a shared retry-with-backoff helper.

## Config

Keep all configuration in one place (`lib/config.py`, `.env`, or equivalent)
with env-var fallbacks. No hardcoded URLs, keys, or model names in individual
scripts.

```python
from lib.config import get_config

config = get_config()
service_url = config.service_url  # not os.getenv(...) scattered everywhere
```

## Logging

```python
import logging
logger = logging.getLogger(__name__)

logger.info("starting %s for %s", task, target)
logger.warning("no results for query: %s", query)
```

- Use module-level loggers, not the root logger.
- Log at the point of failure, not at the top of the call stack.
- Include relevant context (IDs, counts, query text) in messages.
