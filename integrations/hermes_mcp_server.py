#!/usr/bin/env python3
"""Private MCP bridge from Hermes to the REELIST8 Control Plane.

This process exposes only identity resolution and permission-aware search. It
never talks to a model and never exposes SQL or unrestricted database access.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
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


def _get(path: str, params: dict[str, str]) -> dict[str, Any]:
    if not _INTERNAL_SERVICE_TOKEN:
        raise RuntimeError("REELIST8 internal service token is not configured")
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(
        f"{_CONTROL_PLANE_URL}{path}?{query}",
        headers={"Authorization": f"Bearer {_INTERNAL_SERVICE_TOKEN}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Control Plane returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Control Plane is unavailable: {error.reason}") from error


def _delete(path: str, payload: dict[str, Any]) -> dict[str, Any]:
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
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Control Plane returned HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Control Plane is unavailable: {error.reason}") from error


@mcp.tool(description="Get the authenticated employee identity and safe directory context.")
def reelist8_get_employee_context(discord_user_id: str) -> dict[str, Any]:
    """Resolve the caller before using personal or restricted tools."""
    return _post(
        "/v1/identity/resolve",
        {"provider": "DISCORD", "subjectId": discord_user_id.strip()},
    )


@mcp.tool(description="Create a governed REELIST8 upload without making it official.")
def reelist8_create_upload(
    discord_user_id: str,
    filename: str,
    mime_type: str,
    content_base64: str,
    destination: str,
    team_id: str = "",
    project_id: str = "",
    authority_domain: str = "",
) -> dict[str, Any]:
    """Create an upload using an explicit Hermes classification."""
    payload: dict[str, Any] = {
        "discordUserId": discord_user_id.strip(),
        "filename": filename.strip(),
        "mimeType": mime_type.strip(),
        "contentBase64": content_base64,
        "destination": destination,
    }
    if team_id.strip():
        payload["teamId"] = team_id.strip()
    if project_id.strip():
        payload["projectId"] = project_id.strip()
    if authority_domain.strip():
        payload["authorityDomain"] = authority_domain.strip()
    return _post("/v1/uploads", payload)


@mcp.tool(description="Get the extraction/indexing status of an employee-owned REELIST8 upload.")
def reelist8_get_upload_status(discord_user_id: str, version_id: str) -> dict[str, Any]:
    """Return upload processing state without exposing another employee's file."""
    return _get(
        f"/v1/uploads/{urllib.parse.quote(version_id.strip(), safe='')}",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="List only the requesting employee's personal memories.")
def reelist8_list_memory(discord_user_id: str) -> dict[str, Any]:
    """Never accept an employee ID supplied by the model."""
    return _get("/v1/memory", {"discordUserId": discord_user_id.strip()})


@mcp.tool(description="Create an explicit personal memory for the requesting employee.")
def reelist8_create_memory(
    discord_user_id: str,
    memory_type: str,
    content: str,
    sensitivity: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "discordUserId": discord_user_id.strip(),
        "type": memory_type.strip(),
        "content": content,
    }
    if sensitivity.strip():
        payload["sensitivity"] = sensitivity.strip()
    return _post("/v1/memory", payload)


@mcp.tool(description="Delete a personal memory owned by the requesting employee.")
def reelist8_delete_memory(discord_user_id: str, memory_id: str) -> dict[str, Any]:
    return _delete(
        f"/v1/memory/{urllib.parse.quote(memory_id.strip(), safe='')}",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="List SSOT proposals awaiting review in the caller's authorized domains.")
def reelist8_get_review_queue(discord_user_id: str) -> dict[str, Any]:
    return _get("/v1/ssot/review-queue", {"discordUserId": discord_user_id.strip()})


@mcp.tool(description="Create an SSOT proposal for authorized review without publishing official knowledge.")
def reelist8_create_ssot_proposal(
    discord_user_id: str,
    authority_domain: str,
    title: str,
    proposed_content: str,
    source_artifact_ids: list[str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "discordUserId": discord_user_id.strip(),
        "authorityDomain": authority_domain.strip(),
        "title": title.strip(),
        "proposedContent": proposed_content,
    }
    if source_artifact_ids:
        payload["sourceArtifactIds"] = source_artifact_ids
    return _post("/v1/ssot/proposals", payload)


@mcp.tool(description="Approve an SSOT proposal only through the Control Plane authority check.")
def reelist8_approve_ssot_proposal(discord_user_id: str, proposal_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/ssot/proposals/{urllib.parse.quote(proposal_id.strip(), safe='')}/approve",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Reject an SSOT proposal through the Control Plane review workflow.")
def reelist8_reject_ssot_proposal(discord_user_id: str, proposal_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/ssot/proposals/{urllib.parse.quote(proposal_id.strip(), safe='')}/reject",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Request changes on an SSOT proposal through the review workflow.")
def reelist8_request_ssot_changes(discord_user_id: str, proposal_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/ssot/proposals/{urllib.parse.quote(proposal_id.strip(), safe='')}/request-changes",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Prepare an allowlisted action through the REELIST8 action policy.")
def reelist8_prepare_action(
    discord_user_id: str,
    action_type: str,
    parameters: dict[str, Any],
    idempotency_key: str,
    conversation_id: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "discordUserId": discord_user_id.strip(),
        "actionType": action_type.strip(),
        "parameters": parameters,
        "idempotencyKey": idempotency_key.strip(),
    }
    if conversation_id.strip():
        payload["conversationId"] = conversation_id.strip()
    return _post("/v1/actions/prepare", payload)


@mcp.tool(description="Confirm a prepared consequential action for the requesting employee.")
def reelist8_confirm_action(discord_user_id: str, action_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/actions/{urllib.parse.quote(action_id.strip(), safe='')}/confirm",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Execute a confirmed allowlisted action for the requesting employee.")
def reelist8_execute_action(discord_user_id: str, action_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/actions/{urllib.parse.quote(action_id.strip(), safe='')}/execute",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Retrieve the status of an employee-owned action.")
def reelist8_get_action(discord_user_id: str, action_id: str) -> dict[str, Any]:
    return _get(
        f"/v1/actions/{urllib.parse.quote(action_id.strip(), safe='')}",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Cancel an employee-owned prepared or pending action.")
def reelist8_cancel_action(discord_user_id: str, action_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/actions/{urllib.parse.quote(action_id.strip(), safe='')}/cancel",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Prepare linking a new immutable Discord identity to an existing employee code. This never creates a duplicate employee.")
def reelist8_prepare_employee_identity_link(discord_user_id: str, employee_code: str, target_discord_user_id: str) -> dict[str, Any]:
    return _post("/v1/admin/identity-links/prepare", {
        "discordUserId": discord_user_id.strip(),
        "employeeCode": employee_code.strip(),
        "targetDiscordUserId": target_discord_user_id.strip(),
    })


@mcp.tool(description="Prepare a governed staging employee enrollment. Requires an authorized requester, approved RL8 employee code, verified fields, and explicit initial roles; writes nothing.")
def reelist8_prepare_employee_enrollment(
    discord_user_id: str,
    full_name: str,
    company_email: str,
    timezone: str,
    target_discord_user_id: str,
    employee_code: str,
    initial_role_keys: list[str],
    staging_allowlisted: bool = False,
) -> dict[str, Any]:
    return _post("/v1/admin/enrollments/prepare", {
        "discordUserId": discord_user_id.strip(),
        "fullName": full_name,
        "companyEmail": company_email,
        "timezone": timezone,
        "targetDiscordUserId": target_discord_user_id.strip(),
        "employeeCode": employee_code.strip(),
        "initialRoleKeys": initial_role_keys,
        "stagingAllowlisted": staging_allowlisted,
    })


@mcp.tool(description="Confirm a prepared staging employee enrollment. Confirmation is required before the transaction can execute.")
def reelist8_confirm_employee_enrollment(discord_user_id: str, enrollment_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/admin/enrollments/{urllib.parse.quote(enrollment_id.strip(), safe='')}/confirm",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Get the status and summary of an employee enrollment prepared by the requesting admin.")
def reelist8_get_employee_enrollment(discord_user_id: str, enrollment_id: str) -> dict[str, Any]:
    return _get(
        f"/v1/admin/enrollments/{urllib.parse.quote(enrollment_id.strip(), safe='')}",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Cancel a prepared or confirmed staging employee enrollment before execution.")
def reelist8_cancel_employee_enrollment(discord_user_id: str, enrollment_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/admin/enrollments/{urllib.parse.quote(enrollment_id.strip(), safe='')}/cancel",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Execute a confirmed staging employee enrollment in one Control Plane transaction.")
def reelist8_execute_employee_enrollment(discord_user_id: str, enrollment_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/admin/enrollments/{urllib.parse.quote(enrollment_id.strip(), safe='')}/execute",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Prepare a deterministic admin role or SSOT authority change. Execution requires confirmation; the Control Plane enforces HERMES_ADMIN.")
def reelist8_prepare_admin_change(
    discord_user_id: str,
    target_employee_code: str,
    operation: str,
    role_key: str = "",
    authority_domain: str = "",
    authority_permission: str = "",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "discordUserId": discord_user_id.strip(),
        "targetEmployeeCode": target_employee_code.strip(),
        "operation": operation.strip(),
    }
    if role_key.strip(): payload["roleKey"] = role_key.strip()
    if authority_domain.strip(): payload["authorityDomain"] = authority_domain.strip()
    if authority_permission.strip(): payload["authorityPermission"] = authority_permission.strip()
    return _post("/v1/admin/changes/prepare", payload)


@mcp.tool(description="Confirm a prepared admin role or SSOT authority change. Confirmation is required before execution, especially administrator escalation.")
def reelist8_confirm_admin_change(discord_user_id: str, request_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/admin/changes/{urllib.parse.quote(request_id.strip(), safe='')}/confirm",
        {"discordUserId": discord_user_id.strip()},
    )


@mcp.tool(description="Execute a confirmed deterministic admin role or SSOT authority change. The Control Plane rechecks HERMES_ADMIN and writes an audit event.")
def reelist8_execute_admin_change(discord_user_id: str, request_id: str) -> dict[str, Any]:
    return _post(
        f"/v1/admin/changes/{urllib.parse.quote(request_id.strip(), safe='')}/execute",
        {"discordUserId": discord_user_id.strip()},
    )


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
