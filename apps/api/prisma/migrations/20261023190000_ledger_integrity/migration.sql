-- Preserves rows; fails rather than silently repairing any inconsistent legacy ledger.
CREATE UNIQUE INDEX "Order_id_sellerId_key" ON "Order"("id", "sellerId");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_orderId_sellerId_fkey"
  FOREIGN KEY ("orderId", "sellerId") REFERENCES "Order"("id", "sellerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_orderId_fkey";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reward_amount_check"
  CHECK ("type" <> 'DELIVERY_REWARD' OR ("amountPaise" = 500 AND "currency" = 'INR'));
