// Tipos del lado del cliente para el módulo de Inteligencia Preventiva —
// declarados localmente (no importados de src/lib/*.ts) porque esos archivos
// son "server-only"; estos tipos reflejan la forma JSON de las respuestas de
// /api/predictive/**, no las fórmulas en sí.

export type TrendDirection = "positiva" | "negativa" | "estable" | "variable" | "cambio_brusco";

export type TrendIndicatorKey =
  | "cumplimiento"
  | "productividad"
  | "horas_registradas"
  | "consistencia_operativa"
  | "capacidad_disponible"
  | "equilibrio_operativo"
  | "proyectos"
  | "actividades";

export type TrendDataPoint = { label: string; value: number };

export type IndicatorTrend = {
  indicator: TrendIndicatorKey;
  label: string;
  available: boolean;
  reason?: string;
  direction: TrendDirection;
  slope: number;
  coefficientOfVariation: number;
  dataPoints: TrendDataPoint[];
};

export type TrendEngineResponse = {
  userId: string;
  windowWeeks: number;
  indicators: Record<TrendIndicatorKey, IndicatorTrend>;
  engineVersion: string;
  generatedAt: string;
  fromCache: boolean;
};

export type HistoricalReliability = "alta" | "media" | "baja";

export type ExplainablePrediction = {
  horizon: 7 | 15 | 30 | 90;
  confidencePct: number;
  historicalReliability: HistoricalReliability;
  historicalWindowWeeks: number;
  queOcurrira: string;
  porQue: string;
  datosUtilizados: string[];
  variablesConMayorImpacto: string[];
  queHacer: string[];
};

export type CumplimientoProjection =
  | { available: false; reason: string }
  | (ExplainablePrediction & { available: true; cumplimientoEsperadoCierrePct: number; variacionEsperadaPct: number });

export type Nivel = "Alto" | "Medio" | "Bajo";

export type SobrecargaPrediction = { available: false; reason: string } | (ExplainablePrediction & { available: true; probabilidadPct: number; nivel: Nivel });

export type DelayPrediction =
  | { available: false; reason: string }
  | (ExplainablePrediction & { available: true; probabilidadPct: number; nivel: Nivel; motivos: string[] });

export type OperationalStability = {
  classification: "Muy Alta" | "Alta" | "Media" | "Baja" | "Muy Baja";
  averageCoefficientOfVariation: number;
  basedOn: string[];
};

export type PredictionsBundle = {
  cumplimiento: CumplimientoProjection;
  sobrecarga: SobrecargaPrediction;
  estabilidad: OperationalStability;
  taskDelays: { taskId: string; title: string; prediction: DelayPrediction }[];
  fromCache: boolean;
};

export type PreventiveSeverity = "roja" | "naranja" | "amarilla" | "verde";

export type PreventiveAlert = {
  severity: PreventiveSeverity;
  message: string;
  source: string;
  relatedIndicator: string;
};

export type SubutilizacionPrediction = ExplainablePrediction & { nivel: Nivel };

export type TeamSubutilizationMember = { userId: string; name: string; prediction: SubutilizacionPrediction | null };
