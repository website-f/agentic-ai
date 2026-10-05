"""Picture generation for agents (P18): the generate_image tool.

The picture is made by the "image" model group (OpenAI gpt-image-1 / dall-e-3 or any
OpenAI-compatible /images/generations endpoint) and saved as a generated office file, so it
shows in Files and can be attached to work or sent on. Every picture costs money, so the
tool asks a person first by default."""

import re
from typing import Any

from ..documents import provenance
from ..documents import service as doc_service
from ..engine import gateway, media
from .tools import Tool, ToolContext


def _file_name(prompt: str, ext: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", prompt.lower())[:6]
    return f"{'-'.join(words) or 'picture'}.{ext}"


async def _generate_image(ctx: ToolContext, args: dict[str, Any]) -> str:
    prompt = str(args.get("prompt") or "").strip()
    shape = str(args.get("size") or "square").strip().lower()
    if shape not in media.SHAPES:
        shape = "square"
    try:
        pic = await gateway.generate_image(
            ctx.db,
            ctx.workspace.id,
            prompt,
            shape=shape,
            style=str(args.get("style") or "") or None,
            agent_id=ctx.agent.id,
            task_id=ctx.task.id if ctx.task else None,
        )
    except gateway.MediaRejected as e:
        return f"Error: {e}"
    except gateway.NotConfigured as e:
        return f"Error: {e} Tell the person; do not retry."
    except gateway.GatewayUnavailable as e:
        return f"Error: the picture could not be made. {e}"
    f = await doc_service.create_file(
        ctx.db,
        workspace_id=ctx.workspace.id,
        name=_file_name(prompt, pic.ext),
        data=pic.data,
        mime=pic.mime,
        created_by=f"agent:{ctx.agent.id}",
        branch_id=ctx.agent.branch_id,
        task_id=ctx.task.id if ctx.task else None,
        agent_id=ctx.agent.id,
        source="generated",
        status="ready",
        folder=await provenance.ai_folder(ctx.db, ctx.workspace.id, ctx.agent.branch_id, "picture"),
    )
    f.kind = "Picture"
    f.title = prompt[:200]
    f.summary = f"Picture made by generate_image ({pic.model}, {pic.size}): {prompt}"[:1000]
    await ctx.db.commit()
    cost = f", about ${pic.cost_usd:.3f}" if pic.cost_usd else ""
    return (
        f"Picture made and saved to the office files: [{f.id}] {f.name} "
        f"({pic.size}, {pic.model}{cost}). Refer to it by that file id to attach or send it."
    )


MEDIA_TOOLS: list[Tool] = [
    Tool(
        "generate_image",
        "Make a picture",
        "Create a picture from a description (a poster, an illustration, a product mock-up, a "
        "social post image) and save it to the office files. Describe the subject, setting, "
        "colours and any text that must appear. Each picture costs money: make one, not "
        "variations, unless asked.",
        {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "What the picture shows, in detail"},
                "size": {
                    "type": "string",
                    "enum": list(media.SHAPES),
                    "description": "square (default), landscape or portrait",
                },
                "style": {
                    "type": "string",
                    "description": "Optional look, e.g. photo, flat illustration, watercolour",
                },
            },
            "required": ["prompt"],
        },
        "medium",
        "ask",
        _generate_image,
    ),
]
