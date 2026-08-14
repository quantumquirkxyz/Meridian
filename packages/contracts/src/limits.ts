import {
  isNumber,
  isObjectOf,
  isOptional,
  type Validator,
} from "./schema.ts";
import { isDataQualityState, type DataQualityState } from "./data-quality.ts";

/**
 * OrderLimits: the constraint set that bounds an OrderIntent and travels with
 * a RiskDecision approval. Extracted to its own module so both `order.ts` and
 * `risk.ts` can import the type and its runtime validator without a circular
 * runtime dependency (review fix, PR #41).
 */
export interface OrderLimits {
  maxSlippageBps?: number;
  maxGasUsd?: number;
  maxLatencyMs?: number;
  /** Minimum data quality state required to execute. */
  minDataQuality?: DataQualityState;
}

export const isOrderLimits: Validator<OrderLimits> = isObjectOf({
  maxSlippageBps: isOptional(isNumber),
  maxGasUsd: isOptional(isNumber),
  maxLatencyMs: isOptional(isNumber),
  minDataQuality: isOptional(isDataQualityState),
});
