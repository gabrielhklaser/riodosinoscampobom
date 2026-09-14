import { useState } from 'react';

/**
 * Brasão da Prefeitura Municipal de Campo Bom / RS.
 *
 * Estratégia de carregamento (à prova de falhas):
 *  1. cópia local em /brasao-campo-bom.png — brasão oficial embarcado
 *     no projeto, sempre disponível mesmo offline;
 *  2. arquivo hospedado no portal da Prefeitura (reserva);
 *  3. emblema vetorial inline (último recurso).
 */
const LOCAL = 'brasao-campo-bom.png';

const OFICIAL =
  'https://www.campobom.rs.gov.br/wp-content/uploads/2023/LOGOS/' +
  'pmcb_BRAS%C3%83%C6%92O_color-fundo-transparente-Copia-300x297.png';

const CHAIN = [LOCAL, OFICIAL];

export default function Brasao({ className = 'h-12 w-12' }: { className?: string }) {
  const [idx, setIdx] = useState(0);

  if (idx < CHAIN.length) {
    return (
      <img
        src={CHAIN[idx]}
        onError={() => setIdx((i) => i + 1)}
        alt="Brasão da Prefeitura Municipal de Campo Bom / RS"
        className={`${className} object-contain`}
        referrerPolicy="no-referrer"
        loading="eager"
        decoding="async"
      />
    );
  }

  return <BrasaoSVG className={className} />;
}

function BrasaoSVG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Emblema da Prefeitura Municipal de Campo Bom / RS"
    >
      <defs>
        <linearGradient id="bz-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id="bz-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
        <linearGradient id="bz-hill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
        <clipPath id="bz-clip">
          <path d="M32 4 L57 12 V32 C57 46 46 55 32 60 C18 55 7 46 7 32 V12 Z" />
        </clipPath>
      </defs>

      <path d="M32 4 L57 12 V32 C57 46 46 55 32 60 C18 55 7 46 7 32 V12 Z" fill="url(#bz-gold)" />

      <g clipPath="url(#bz-clip)">
        <rect x="7" y="4" width="50" height="56" fill="url(#bz-sky)" />
        <circle cx="32" cy="20" r="6" fill="#fde047" opacity="0.95" />
        <path d="M7 34 C16 25 24 33 32 30 C41 27 49 34 57 29 V60 H7 Z" fill="url(#bz-hill)" />
        <path
          d="M7 44 C16 40 20 48 30 45 C40 42 47 50 57 46 L57 54 C47 58 40 50 30 53 C20 56 16 48 7 52 Z"
          fill="#e0f2fe"
          opacity="0.92"
        />
      </g>

      <path
        d="M32 4 L57 12 V32 C57 46 46 55 32 60 C18 55 7 46 7 32 V12 Z"
        fill="none"
        stroke="#78350f"
        strokeWidth="2"
      />
    </svg>
  );
}
