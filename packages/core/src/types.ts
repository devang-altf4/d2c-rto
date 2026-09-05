/**
 * FROZEN CONTRACT — agreed at H1.
 *
 * All three workstreams code against this file. Changing anything here means
 * shouting first, because someone else is already building against it.
 *
 * The Ports at the bottom are the important part: the ops UI depends on the
 * interface, never on Rohit's or Devang's implementation. That is what lets
 * three people build in parallel and integrate at H16 instead of praying.
 */

export type Level = 'L1' | 'L2' | 'L3';
export type Size = 'XS' | 'S' | 'M' | 'L' | 'XL';
export const SIZES: Size[] = ['XS', 'S', 'M', 'L', 'XL'];

export type FitSource = 'CAMERA' | 'CROSS_BRAND' | 'SKIPPED';
export type PaymentMode = 'COD' | 'PREPAID';

// ------------------------------------------------------------------ L1 · fit

/** Body measurements, in cm. Produced by EITHER the camera or the dropdown. */
export interface BodyMeasurement {
  source: FitSource;
  heightCm?: number;
  bodyChestCm: number;
  shoulderCm?: number;
  /** 0..1 — camera is lower and honest about it. */
  confidence: number;
}

/** Garment-side spec for one SKU. The defensible asset. */
export interface GarmentSpec {
  skuId: string;
  styleId: string;
  styleName: string;
  size: Size;
  chestCm: number;
  easeCm: number;
  /** Learned from exchange reconciliation. Positive = style runs small. */
  learnedOffsetCm: number;
}

export interface FitRecommendation {
  recommendedSize: Size;
  confidence: number;
  bodyChestCm: number;
  /** What the manufacturer's chart alone would have said. */
  naiveSize: Size;
  /** True when reconciliation moved the answer — the demo moment. */
  correctionApplied: boolean;
  learnedOffsetCm: number;
  /** One plain sentence, rendered to the shopper. */
  reason: string;
}

// ------------------------------------------------------------- L2 targeting

export interface RiskComponents {
  styleHistory: number;
  noL1: number;
  cod: number;
  firstOrder: number;
  tier: number;
}

export interface RiskBreakdown {
  /** 0..1 */
  score: number;
  components: RiskComponents;
  /** Above this, the order enters the L2 queue. */
  atRisk: boolean;
}

export interface RiskInput {
  styleSizeFailureRate: number; // 0..1, from the historical corpus
  usedL1: boolean;
  paymentMode: PaymentMode;
  isFirstOrder: boolean;
  tier: 1 | 2 | 3;
}

// ---------------------------------------------------------------------- ports

export interface OutboundResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

/** Context handed to L2 and L3. Everything either channel needs to say. */
export interface ConfirmationContext {
  orderId: string;
  humanId: string;
  customerName: string;
  phone: string; // E.164
  styleName: string;
  size: Size;
  amountPaise: number;
  paymentMode: PaymentMode;
  /** Set when L1 ran and disagreed with what she actually chose. */
  recommendedSize?: Size;
}

/** L2 — Rohit implements this in @rto/whatsapp. */
export interface WhatsAppPort {
  sendConfirmation(ctx: ConfirmationContext): Promise<OutboundResult>;
}

/** L3 — Devang implements this in @rto/voice. */
export interface VoicePort {
  placeConfirmationCall(ctx: ConfirmationContext): Promise<OutboundResult>;
}

// ------------------------------------------------------------------- events

export type EventType =
  | 'fit.started'
  | 'fit.recommended'
  | 'fit.skipped'
  | 'order.placed'
  | 'risk.scored'
  | 'wa.sent'
  | 'wa.delivered'
  | 'wa.replied'
  | 'wa.timeout'
  | 'call.placed'
  | 'call.completed'
  | 'call.no_answer'
  | 'order.confirmed'
  | 'order.cancelled';

export interface TimelineEvent {
  id: string;
  orderId: string;
  level: Level;
  type: EventType;
  label: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

// -------------------------------------------------------------- diagnosis

/** Precomputed at seed time into data/diagnosis.json. Read-only. */
export interface DiagnosisStyle {
  styleId: string;
  styleName: string;
  rtoCount: number;
  deliveredCount: number;
  sizeExchangeRate: number;
  attributedSizeRto: number;
  attributedRupees: number;
  /** Ground truth from the generator — used to compute recall, never shown as input. */
  actuallyRunsSmall: boolean;
}

export interface Diagnosis {
  totalOrders: number;
  totalRto: number;
  totalRtoRupees: number;
  attributedSizeRupees: number;
  /** Fraction of injected bad-chart styles our ranking recovers. Put the real number on the slide. */
  recall: number;
  /** What the courier panel shows — the bucket that hides everything. */
  courierBreakdown: { code: string; count: number; rupees: number }[];
  styles: DiagnosisStyle[];
}
