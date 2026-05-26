import { adminDb } from "@/lib/firebase/admin";
import { notFound } from "next/navigation";
import ResultClient from "./ResultClient";
import { ensureMarkdownContent } from "@/lib/markdown/normalize";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const docRef = adminDb.collection("outputs").doc(id);
  const docSnap = await docRef.get();

  if (!docSnap.exists) {
    return notFound();
  }

  const data = docSnap.data();

  const initialPrdContent = ensureMarkdownContent(data?.prd_content, {
    fallback: "Data PRD tidak ditemukan.",
    title: "PRD",
  });
  const initialUiPromptContent = ensureMarkdownContent(data?.ui_prompt_content, {
    fallback: "Data UI Prompt tidak ditemukan.",
    title: "UI Prompt",
  });

  return (
    <ResultClient 
      id={id} 
      initialPrdContent={initialPrdContent} 
      initialUiPromptContent={initialUiPromptContent} 
    />
  );
}
