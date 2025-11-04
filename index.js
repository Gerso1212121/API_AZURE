require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const DocumentIntelligence = require("@azure-rest/ai-document-intelligence").default;
const { getLongRunningPoller, isUnexpected } = require("@azure-rest/ai-document-intelligence");

const app = express();
const upload = multer({ dest: "uploads/" });

const key = process.env.FORM_RECOGNIZER_KEY || "TU_KEY_AQUI";
const endpoint = process.env.FORM_RECOGNIZER_ENDPOINT || "TU_ENDPOINT_AQUI";

function safeValue(field) {
  if (!field) return undefined;
  return field.valueString ?? field.valueDate ?? field.valueNumber ?? field.valueCountryRegion ?? field.value ?? undefined;
}

app.post("/analyze-id", upload.single("file"), async (req, res) => {
  console.log("📥 Solicitud recibida en /analyze-id");

  try {
    if (!req.file) {
      console.log("⚠️ No se recibió ningún archivo");
      return res.status(400).json({ error: "Debes enviar una imagen en el campo 'file'." });
    }

    console.log(`📁 Archivo recibido: ${req.file.originalname}, tamaño: ${req.file.size} bytes`);

    // Leer archivo subido
    const idDocumentFile = fs.readFileSync(req.file.path);
    console.log("📂 Archivo leído correctamente desde uploads/");

    // Inicializar cliente de Azure
    const client = DocumentIntelligence(endpoint, { key });
    console.log("🔑 Cliente de Azure Document Intelligence inicializado");

    const modelId = "prebuilt-idDocument";
    console.log(`🛠️ Analizando documento usando modelo: ${modelId}`);

    const initialResponse = await client
      .path("/documentModels/{modelId}:analyze", modelId)
      .post({
        body: idDocumentFile,
        contentType: "application/octet-stream",
      });

    if (isUnexpected(initialResponse)) {
      console.log("❌ Error inesperado en la respuesta de Azure:", initialResponse.body.error);
      throw initialResponse.body.error;
    }

    console.log("⏳ Esperando resultado del análisis (Long Running Operation)");

    const poller = getLongRunningPoller(client, initialResponse);
    const analyzeResult = (await poller.pollUntilDone()).body.analyzeResult;

    console.log("✅ Análisis completado, procesando resultados");

    const result = analyzeResult?.documents?.[0];
    if (!result) {
      console.log("⚠️ No se extrajo ningún documento del análisis");
      throw new Error("No se extrajo ningún documento.");
    }

    const FirstName = safeValue(result.fields?.FirstName);
    const LastName = safeValue(result.fields?.LastName);
    const DocumentNumber = safeValue(result.fields?.DocumentNumber) || safeValue(result.fields?.IdentityNumber);
    const DateOfBirth = safeValue(result.fields?.DateOfBirth);
    const Nationality = safeValue(result.fields?.Nationality);
    const DateOfExpiration = safeValue(result.fields?.DateOfExpiration);
    const FullName = safeValue(result.fields?.FullName) || (FirstName && LastName ? `${FirstName} ${LastName}` : undefined);

    // Eliminar archivo temporal
    fs.unlinkSync(req.file.path);
    console.log("🗑️ Archivo temporal eliminado");

    // Enviar respuesta al cliente
    console.log("📤 Enviando resultado al cliente");
    res.json({
      success: true,
      docType: result.docType,
      fullName: FullName,
      firstName: FirstName,
      lastName: LastName,
      documentNumber: DocumentNumber,
      dateOfBirth: DateOfBirth,
      nationality: Nationality,
      dateOfExpiration: DateOfExpiration,
      allFields: Object.fromEntries(Object.entries(result.fields || {}).map(([k, v]) => [k, safeValue(v)])),
    });

  } catch (error) {
    console.error("❌ Error analizando documento:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));
