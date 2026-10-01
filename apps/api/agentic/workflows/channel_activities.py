"""Activities for the delivery ledger."""

from temporalio import activity
from temporalio.exceptions import ApplicationError

from ..channels import deliver
from ..core.db import SessionLocal


@activity.defn
async def deliver_one(delivery_id: str) -> str:
    async with SessionLocal() as db:
        try:
            return await deliver.deliver(db, delivery_id)
        except deliver.Retry as e:
            raise ApplicationError(str(e), type="Retry") from e
