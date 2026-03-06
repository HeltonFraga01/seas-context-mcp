export async function embedTexts(texts: string[], model = 'text-embedding-3-small'): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || texts.length === 0) {
    return [];
  }
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, input: texts })
  });
  if (!resp.ok) {
    throw new Error(`OpenAI embeddings failed: ${resp.status} ${await resp.text()}`);
  }
  const json = await resp.json() as { data: Array<{ embedding: number[] }> };
  return json.data.map((item) => item.embedding);
}
