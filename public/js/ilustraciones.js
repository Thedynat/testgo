/*
 * Ilustraciones de línea para el panel del profesor (dibujadas para TestGO).
 * Trazo oscuro redondeado y rellenos suaves con los colores de la web,
 * así se adaptan solas si cambian las variables de estilos.css.
 */

const T = 'var(--texto)'; // trazo
const B = 'var(--superficie)'; // relleno blanco
const S = 'var(--acento-suave)'; // relleno suave
const A = 'var(--acento)'; // color de acento
const C = 'var(--celeste)';
const G = 'var(--superficie-2)';

const trazo = `stroke="${T}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;

const DIBUJOS = {
  // Un documento que entra en una bandeja, con la flecha de subir
  importar: `
    <svg viewBox="0 0 160 110">
      <g ${trazo}>
        <path d="M28 82h104v12a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6z" fill="${S}"/>
        <path d="M54 14h36l14 14v54H54z" fill="${B}"/>
        <path d="M90 14v14h14" fill="none"/>
        <path d="M63 38h26M63 47h32M63 56h20M63 65h28" fill="none"/>
        <circle cx="124" cy="40" r="13" fill="${A}"/>
        <path d="M124 47V33M118.5 38.5 124 33l5.5 5.5" stroke="#fff" fill="none"/>
        <path d="M36 30v9M31.5 34.5h9" fill="none"/>
      </g>
      <circle cx="140" cy="70" r="2.5" fill="${T}"/>
      <circle cx="44" cy="58" r="2" fill="${T}"/>
    </svg>`,

  // Una hoja con casillas y un lápiz que acaba de escribir
  desdeCero: `
    <svg viewBox="0 0 160 110">
      <g ${trazo}>
        <g transform="rotate(-5 74 56)">
          <rect x="42" y="14" width="64" height="82" rx="5" fill="${B}"/>
          <rect x="52" y="30" width="10" height="10" rx="2.5" fill="${A}"/>
          <path d="M54.5 35.2l2.2 2.2 4-4.4" stroke="#fff" fill="none"/>
          <path d="M68 35h28" fill="none"/>
          <rect x="52" y="49" width="10" height="10" rx="2.5" fill="${B}"/>
          <path d="M68 54h22" fill="none"/>
          <rect x="52" y="68" width="10" height="10" rx="2.5" fill="${B}"/>
          <path d="M68 73q4-4 8 0t8 0" stroke="${A}" fill="none"/>
        </g>
        <g transform="translate(96 82) rotate(-52)">
          <path d="M0 0l11-5.5v11z" fill="${B}"/>
          <rect x="11" y="-5.5" width="38" height="11" fill="${C}"/>
          <rect x="49" y="-5.5" width="9" height="11" rx="2" fill="${S}"/>
        </g>
      </g>
      <path d="M96 82l3.4-1.7v3.4z" fill="${T}" transform="rotate(-52 96 82)"/>
      <path d="M128 22v8M124 26h8" ${trazo} fill="none"/>
    </svg>`,

  // Profesor en su mesa con el portátil, papeles y una planta (sin exámenes todavía)
  mesa: `
    <svg viewBox="0 0 260 160">
      <g ${trazo}>
        <path d="M76 120c1-34 14-48 32-48s31 14 32 48z" fill="${A}"/>
        <path d="M100 72l8 12 8-12" fill="${B}"/>
        <circle cx="108" cy="50" r="15" fill="${B}"/>
        <path d="M93 50c-1-15 9-22 19-20 9 2 13 9 11 18-6-6-15-7-22-4-3 1-6 4-8 6z" fill="${T}"/>
        <path d="M104 54h.01M113 54h.01" stroke-width="3"/>
        <path d="M105 60q3.5 2.5 7 0" fill="none"/>
        <path d="M134 98c5 2 9 7 11 13" fill="none"/>
        <path d="M140 116l8-34h48l-8 34z" fill="${B}"/>
        <circle cx="169" cy="99" r="4" fill="${S}"/>
        <path d="M134 118h66" fill="none"/>
        <path d="M30 120h200" fill="none"/>
        <path d="M44 120v28M216 120v28" fill="none"/>
        <path d="M46 112h34v8H46zM50 104h30v8H50z" fill="${B}"/>
        <path d="M54 100h22" fill="none"/>
        <path d="M222 120h-16l-2-20h20z" fill="${S}"/>
        <path d="M214 100c-2-10-10-14-16-14 2 8 8 13 16 14zM214 100c0-12 6-18 14-20 0 10-6 17-14 20z" fill="${G}"/>
      </g>
      <path d="M38 40v9M33.5 44.5h9" ${trazo} fill="none"/>
      <circle cx="236" cy="56" r="3" fill="${C}"/>
      <circle cx="58" cy="70" r="2.5" fill="${T}"/>
    </svg>`,

  // Lupa sobre una hoja: ningún examen coincide con la búsqueda
  buscar: `
    <svg viewBox="0 0 160 110">
      <g ${trazo}>
        <rect x="38" y="16" width="56" height="74" rx="5" fill="${B}"/>
        <path d="M48 32h36M48 42h28M48 52h32" fill="none"/>
        <circle cx="92" cy="60" r="20" fill="${S}"/>
        <path d="M106.5 74.5 124 92" stroke-width="6"/>
        <path d="M86 54q6-4 12 2" fill="none"/>
      </g>
      <circle cx="130" cy="36" r="2.5" fill="${T}"/>
    </svg>`,
};

export function ilustracion(nombre, clase = '') {
  const plantilla = document.createElement('template');
  plantilla.innerHTML = DIBUJOS[nombre].trim();
  const svg = plantilla.content.firstElementChild;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ilustracion ${clase}`.trim());
  return svg;
}
