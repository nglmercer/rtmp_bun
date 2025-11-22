import { spawn } from "child_process";
import os from "os";

const platform = os.platform();

console.log(`🖥️  Detectando plataforma: ${platform}`);

let command = "";
let args: string[] = [];

// Definir comandos según el OS
if (platform === "linux") {
  // Asumimos Debian/Ubuntu (lo más común en servidores)
  command = "sudo";
  args = [
    "apt-get", "install", "-y",
    "libgstreamer1.0-dev",
    "libgstreamer-plugins-base1.0-dev",
    "libgstreamer-plugins-bad1.0-dev",
    "gstreamer1.0-plugins-base",
    "gstreamer1.0-plugins-good",
    "gstreamer1.0-plugins-bad",
    "gstreamer1.0-plugins-ugly",
    "gstreamer1.0-tools",
    "gstreamer1.0-libav"
  ];
} else if (platform === "darwin") {
  // macOS (requiere Homebrew instalado)
  command = "brew";
  args = ["install", "gstreamer", "gst-plugins-base", "gst-plugins-good", "gst-plugins-bad", "gst-plugins-ugly", "gst-libav"];
} else if (platform === "win32") {
  // Windows (requiere Chocolatey o Winget)
  // Usando Chocolatey por ser más fácil de scriptear
  command = "choco";
  args = ["install", "-y", "gstreamer"];
} else {
  console.error("❌ Plataforma no soportada automáticamente.");
  process.exit(1);
}

console.log(`🛠️  Ejecutando: ${command} ${args.join(" ")}`);

// Ejecutar el proceso
const installProcess = spawn(command, args, { stdio: "inherit", shell: true });

installProcess.on("close", (code) => {
  if (code === 0) {
    console.log("✅ GStreamer instalado correctamente.");
  } else {
    console.error(`❌ Error en la instalación. Código de salida: ${code}`);
    if (platform === "linux") console.log("Nota: Asegúrate de tener permisos de sudo.");
  }
});