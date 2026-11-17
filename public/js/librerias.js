// Carga bajo demanda las librerías de la carpeta vendor (solo las necesita el profesor)

const cargando = {};

function cargarScript(src) {
  cargando[src] ??= new Promise((resolver, rechazar) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolver;
    s.onerror = () => {
      delete cargando[src];
      rechazar(new Error(`No se ha podido cargar ${src}`));
    };
    document.head.append(s);
  });
  return cargando[src];
}

export async function jszip() {
  await cargarScript('/vendor/jszip.min.js');
  return window.JSZip;
}

export async function jspdf() {
  await cargarScript('/vendor/jspdf.umd.min.js');
  return window.jspdf.jsPDF;
}

export async function pdfjs() {
  const pdf = await import('/vendor/pdf.min.mjs');
  pdf.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
  return pdf;
}
