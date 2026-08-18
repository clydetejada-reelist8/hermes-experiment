#!/usr/bin/env python3
"""Private MCP bridge from Hermes to the REELIST8 Control Plane.

This process exposes only identity resolution and permission-aware search. It
never talks to a model and never exposes SQL or unrestricted database access.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from mcp.server.mcpserver import MCPServer


SECRET_FILE = Path.home() / ".hermes" / "reelist8-control-plane.env"


def _load_secret_file() -> dict[str, str]:
    values: dict[str, str] = {}
    if not SECRET_FILE.exists():
        return values
    for raw_line in SECRET_FILE.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


_file_values = _load_secret_file()
_CONTROL_PLANE_URL = os.environ.get(
    "REELIST8_CONTROL_PLANE_URL",
    _file_values.get("REELIST8_CONTROL_PLANE_URL", "http://127.0.0.1:3000"),
).rstrip("/")
_INTERNAL_SERVICE_TOKEN = os.environ.get(
    "REELIST8_INTERNAL_SERVICE_TOKEN",
    _file_values.get("REELIST8_INTERNAL_SERVICE_TOKEN", ""),
)

mcp = MCPServer(name="reelist8-control-plane", version="0.1.0")


def _post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not _INTERNAL_SERVICE_TOKEN:
        raise RuntimeError("REELIST8 internal service token is not configured")
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{_CONTROL_PLANE_URL}{path}",
        data=body,
        headers={
            "Authorization": f"Bearer {_INTERNAL_SERVICE_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Control Plane returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Control Plane is unavailable: {error.reason}") from error


@mcp.tool(description="Resolve a Discord user to a canonical REELIST8 employee identity.")
def reelist8_resolve_identity(discord_user_id: str) -> dict[str, Any]:
    """Resolve a Discord user to a canonical REELIST8 employee identity."""
    return _post(
        "/v1/identity/resolve",
        {"provider": "DISCORD", "subjectId": discord_user_id.strip()},
    )


@mcp.tool(description="Search only REELIST8 evidence visible to the Discord employee.")
def reelist8_search(
    discord_user_id: str, query: str, limit: int = 10
) -> dict[str, Any]:
    """Search only REELIST8 evidence visible to the Discord employee."""
    return _post(
        "/v1/search",
        {
            "discordUserId": discord_user_id.strip(),
            "query": query.strip(),
            "limit": max(1, min(int(limit), 20)),
        },
    )


@mcp.tool(
    description=(
        "Retrieve the complete canonical text of an authorized official REELIST8 SSOT version. "
        "Use this for official-values or official-policy questions when exact wording matters."
    )
)
def reelist8_get_ssot_document(discord_user_id: str, ssot_version_id: str) -> dict[str, Any]:
    """Retrieve a complete authorized SSOT document without summarizing it."""
    return _post(
        "/v1/ssot/document",
        {
            "discordUserId": discord_user_id.strip(),
            "ssotVersionId": ssot_version_id.strip(),
        },
    )


if __name__ == "__main__":
    mcp.run("stdio")
