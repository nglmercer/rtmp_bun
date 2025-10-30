// Simular una respuesta API para test stream
export async function onRequestPost({ request }) {
  try {
    // Aquí podrías generar un stream de prueba
    // Por ahora solo respondemos que el test fue iniciado

    return new Response(
      JSON.stringify({
        success: true,
        message: "Test stream iniciado exitosamente",
        streamKey: "test",
        url: "ws://localhost:1936/stream/test",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
