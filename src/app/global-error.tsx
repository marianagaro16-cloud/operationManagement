'use client';

/*
 * What is shown when a screen breaks, instead of the browser's bare
 * "Application error". Most often the screen was open while the app was
 * updated, and a reload is all it takes — so the reload is the button.
 * Outside every layout: no translations here, and its own html and body.
 */
export default function GlobalError() {
  return (
    <html lang="es">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#fafafa', color: '#171717' }}>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Algo salió mal</p>
          <p style={{ fontSize: 14, color: '#525252', margin: 0, maxWidth: 320 }}>
            Puede que la aplicación se haya actualizado mientras tenías esta pantalla abierta. Vuelve a cargarla.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 8, padding: '10px 20px', fontSize: 15, fontWeight: 600, color: '#fff', background: '#171717', border: 0, borderRadius: 10, cursor: 'pointer' }}
          >
            Recargar
          </button>
        </div>
      </body>
    </html>
  );
}
