/**
 * Avisos meteorológicos do INMET para Campo Bom/RS.
 *
 * O NAVEGADOR NUNCA chama a API do INMET diretamente (CORS + risco de
 * bloqueio por excesso de consultas): o backend do próprio painel serve
 * `/api/alertas/campo-bom` já filtrado por município (IBGE 4303905), com
 * cache de 12 min e fallback gracioso quando o INMET está fora do ar.
 */

export type InmetSeveridade = 'amarelo' | 'laranja' | 'vermelho';

export interface InmetAviso {
  id: string;
  /** tipo do evento, ex.: "Chuvas Intensas", "Tempestade", "Baixa Umidade" */
  tipo: string;
  severidade: InmetSeveridade;
  /** rótulo original do INMET, ex.: "Perigo Potencial" */
  severidadeOriginal: string | null;
  /** 'hoje' = vigente agora; 'futuro' = aviso publicado que inicia depois */
  periodo: 'hoje' | 'futuro';
  /** epoch ISO (wall-clock local UTC-3 já convertido) */
  inicio: string | null;
  fim: string | null;
  riscos: string[];
  instrucoes: string[];
}

export interface InmetResult {
  ok: boolean;
  municipio: string;
  fonte: string;
  /** epoch (ms) da última consulta bem-sucedida à INMET */
  atualizadoEm: number | null;
  /** true quando o INMET está fora do ar e a lista é o último estado válido (ou vazia) */
  fallback: boolean;
  avisos: InmetAviso[];
}

export async function fetchInmetAlerts(): Promise<InmetResult> {
  const resp = await fetch('/api/alertas/campo-bom', { cache: 'no-store' });
  if (!resp.ok) throw new Error(`Falha ao consultar avisos (HTTP ${resp.status})`);
  return (await resp.json()) as InmetResult;
}

/** "21/09 09:03" no fuso de Brasília (a INMET reporta horário local). */
export function fmtInmetHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
