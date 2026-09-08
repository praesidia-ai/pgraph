export async function authenticate(email: string): Promise<{ email: string }> {
  if (!email.includes("@")) throw new Error("Invalid email");
  return { email };
}
