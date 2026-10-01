from temporalio import activity


@activity.defn
async def pong(payload: str) -> str:
    return f"pong:{payload}"
