export default function Home() {
  return (
    <main>
      <h1>Account dashboard</h1>
    </main>
  );
}
export function useAccount() {
  return { signedIn: false };
}
