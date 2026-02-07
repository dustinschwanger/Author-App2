
import { GoogleGenAI, Type } from "@google/genai";
import { Book, ExtractionResult, Highlight } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to robustly extract JSON from a response that might contain markdown or conversation
const extractJson = (text: string) => {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    return text.substring(firstBrace, lastBrace + 1);
  }
  return text.replace(/```json\n?|```/g, '').trim();
};

export const searchForBook = async (query: string): Promise<Book | null> => {
  try {
    // Determine if we are searching by ISBN or general text
    const isIsbn = query.startsWith('isbn:');
    const searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`;
    
    const response = await fetch(searchUrl);
    
    if (!response.ok) {
      throw new Error('Google Books API failed');
    }

    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      const info = data.items[0].volumeInfo;
      
      // Try to get the best possible image from Google
      let coverUrl = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
      
      // Upgrade http to https and try to remove zoom parameter for better quality
      if (coverUrl) {
        coverUrl = coverUrl.replace('http:', 'https:').replace('&zoom=1', '&zoom=0');
      }

      // FALLBACK: If Google has no image, and we have an ISBN, try Open Library
      if (!coverUrl && isIsbn) {
         const isbn = query.replace('isbn:', '');
         coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
      }

      return {
        id: crypto.randomUUID(),
        title: info.title,
        author: info.authors ? info.authors[0] : "Unknown Author",
        // If still no cover, return placeholder
        coverUrl: coverUrl || `https://placehold.co/400x600?text=${encodeURIComponent(info.title)}`,
        totalHighlights: 0,
      };
    } else if (isIsbn) {
      // If Google Books failed on ISBN, try Open Library directly for metadata? 
      // For now, we return null and let the app handle fallback.
      return null;
    }
    
    return null;
  } catch (error) {
    console.error("Error searching Google Books:", error);
    return null;
  }
};

export const identifyBookFromCover = async (base64Image: string): Promise<{ title: string; author: string; isbn?: string } | null> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;

    // Use gemini-3-flash-preview for book identification with googleSearch grounding.
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data
            }
          },
          {
            text: `Identify this book from the image. 
            1. Read the text on the cover.
            2. Use Google Search to find the exact Title, Author, and best ISBN-13.
            3. Return a JSON object with:
               - "title": The exact title.
               - "author": The exact author name.
               - "isbn": The 13-digit ISBN (digits only), if found.
            
            Output ONLY the raw JSON object.`
          }
        ]
      },
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const cleanText = extractJson(response.text || "{}");
    try {
      const parsed = JSON.parse(cleanText);
      // Validate we actually got something
      if (!parsed.title) return null;
      return parsed;
    } catch (e) {
      console.warn("Failed to parse identification JSON", cleanText);
      return null;
    }
  } catch (error) {
    console.error("Error identifying book:", error);
    return null;
  }
};

export const analyzeHighlightImage = async (base64Image: string): Promise<ExtractionResult> => {
  try {
    const base64Data = base64Image.split(',')[1] || base64Image;

    // Use gemini-3-flash-preview for complex extraction and JSON response.
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data
            }
          },
          {
            text: `Analyze this image of a book page. 
            1. Extract the specific text that appears highlighted (e.g. yellow marker, underlined). If nothing is strictly highlighted, extract the main central paragraph.
            2. Look for a visible page number in the corners or margins.
            Return JSON.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "The transcribed highlighted text" },
            pageNumber: { type: Type.INTEGER, description: "The visible page number, or null if not found" }
          },
          required: ["text"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");
    return {
      text: result.text || "",
      pageNumber: result.pageNumber || null
    };

  } catch (error) {
    console.error("Error analyzing image:", error);
    return { text: "Could not transcribe text. Please enter manually.", pageNumber: null };
  }
};

export const synthesizeBook = async (book: Book, highlights: Highlight[]): Promise<string> => {
  try {
    const highlightsText = highlights.map(h => {
      const thoughtsText = h.thoughts.map(t => `My Thought: ${t.text}`).join('\n');
      return `Highlight (Page ${h.pageNumber || 'N/A'}): "${h.text}"\n${thoughtsText}`;
    }).join('\n---\n');

    const prompt = `You are an expert editor and intellectual partner.
    I have read the book "${book.title}" by ${book.author} and captured the following highlights and personal thoughts.
    
    Please write a cohesive, insightful essay (approx 400-600 words) that synthesizes my key takeaways from this book.
    - Don't just list the highlights. Connect the dots between them.
    - Use my personal thoughts to frame the narrative where possible.
    - Structure the essay with a creative title and elegant markdown-style headers (##).
    - Use clear, sophisticated prose.

    Here is the data:
    ${highlightsText}`;

    // Use gemini-3-flash-preview for summarization and writing tasks.
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });

    return response.text || "Unable to generate synthesis.";
  } catch (error) {
    console.error("Error synthesizing book:", error);
    throw error;
  }
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
  try {
    const base64Data = base64Audio.split(',')[1] || base64Audio;
    
    // Use gemini-3-flash-preview for audio transcription.
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          {
            text: `The user is dictating a personal thought or note about a book.
            1. Transcribe the audio to text accurately.
            2. Lightly edit to remove filler words (um, uh) and fix stutters.
            3. Return ONLY the text.`
          }
        ]
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("Error transcribing audio:", error);
    throw error;
  }
};
