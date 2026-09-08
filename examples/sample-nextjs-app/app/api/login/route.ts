import { authenticate } from "../../../auth.js";
export async function POST(request: Request): Promise<Response> {
  const credentials = await request.json();
  return Response.json(await authenticate(credentials.email));
}
