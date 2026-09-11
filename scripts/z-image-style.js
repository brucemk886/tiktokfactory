export const Z_IMAGE_OFFICIAL_PROMPTS = [
  {
    id: "marais-morning",
    lighting: "iphone-daylight",
    prompt: "Generate a photorealistic image of a cafe terrace in the Marais district of Paris on a Wednesday morning in March 2025. It is a crisp, cool spring morning with clear skies. Locals are drinking coffee. In sharp focus should be a young woman with a pixie cut wearing a scarf, stirring a cappuccino and looking thoughtfully to the side; the waiter and street traffic behind her are blurred. The photo should have the candid, natural morning light feel of an iPhone image."
  },
  {
    id: "balcony-flash-night",
    lighting: "flash-night",
    prompt: "A realistic, high-resolution night photograph mimicking the aesthetic of flash photography, featuring a stylish young couple posing closely together on an elegant stone balcony with a classic white balustrade. The young woman, positioned on the left with her body angled slightly away, has long, voluminous honey-blonde wavy hair cascading down her back and is wearing a black spaghetti-strap mini dress featuring intricate lace detailing on the bodice and a tiered, ruffled skirt; she looks back over her shoulder at the camera with a soft, pleasant smile while resting one hand on the man's shoulder. Beside her stands a handsome young man with tan skin, dark curly hair styled with a fade, and a confident expression, dressed in a crisp black button-down shirt tucked into black dress pants with a visible leather belt, his arm wrapped affectionately around her waist. The setting is nighttime with a pitch-black sky and distant, out-of-focus city lights visible in the background, contrasting with the bright, direct lighting on the subjects and the white architectural column on the right, capturing a candid, trendy \"date night\" or homecoming social media vibe."
  }
];

export function isZImageModel(value) {
  return String(value || "").trim() === "z-image";
}

export function selectedModelsUseZImage(models) {
  return (Array.isArray(models) ? models : [models]).some((item) => isZImageModel(item));
}

export const Z_IMAGE_WRITER_REFERENCE = Z_IMAGE_OFFICIAL_PROMPTS[0];

export function zImageWriterInstructions({ purpose = "scene" } = {}) {
  const layout = purpose === "quiz-grid"
    ? "Keep the required choice layout, but photograph real people, objects, and places instead of drawing a quiz board."
    : purpose === "test-asset"
      ? "Photograph one clear test subject with real depth of field. Leave clean space near the top for a title added later."
      : "Photograph a complete real-world scene that carries the metaphor. Do not describe paper, torn edges, illustration, or collage.";
  return [
    "This official Z-Image prompt is REFERENCE ONLY for writing style. Do not copy its cafe, people, clothes, or location. Do not paste it into the image-generation prompt.",
    `Reference: ${Z_IMAGE_WRITER_REFERENCE.prompt}`,
    "Write a new English image prompt for the current topic, matching only this rhythm: photorealistic camera photograph; specific place and time; weather or ambient light; who is in frame; hair, clothes, pose, and expression; what is sharp vs blurred; candid iPhone daylight or, for night scenes, direct flash against a dark out-of-focus background.",
    "One continuous English paragraph. Concrete nouns and camera language. No illustration, 3D, cartoon, poster, or paper collage.",
    layout,
    "Do not request readable text, logos, captions, watermarks, or UI unless the quiz type explicitly needs digits or A-F markers."
  ].join("\n");
}
