import toast from "react-hot-toast";

export function showSuccessToast(message: string) {
  toast.success(message);
}

export function showErrorToast(error: unknown, fallback: string) {
  toast.error(getErrorMessage(error, fallback));
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return fallback;
}
