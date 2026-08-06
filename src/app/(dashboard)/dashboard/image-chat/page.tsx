import type { Metadata } from "next";
import ImageChatClient from "./ImageChatClient";

export const metadata: Metadata = {
  title: "Image Chat",
};

/**
 * /dashboard/image-chat — multimodal lab page.
 *
 * Chat against a vision-verified route, attach references (upload or clipboard),
 * and generate/edit images through the images endpoints. Image dispatch is
 * EXPLICIT (buttons), never inferred from the prompt: a generation costs ~20s
 * and burns quota, so an accidental trigger is expensive.
 */
export default function ImageChatPage() {
  return <ImageChatClient />;
}
