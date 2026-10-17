"""محرك القوالب — Jinja2 (skill: pallets/jinja) مع fallback آمن."""
import re
from jinja2 import Environment, BaseLoader, StrictUndefined, TemplateError

_env = Environment(loader=BaseLoader(), undefined=StrictUndefined)
_VAR_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")

def extract_variables(body: str) -> list[str]:
    return sorted(set(_VAR_RE.findall(body)))

def render(body: str, context: dict) -> str:
    try:
        return _env.from_string(body).render(**context)
    except TemplateError as e:
        raise ValueError(f"template render error: {e}") from e

def validate(body: str) -> None:
    try:
        _env.parse(body)
    except TemplateError as e:
        raise ValueError(f"invalid template syntax: {e}") from e
