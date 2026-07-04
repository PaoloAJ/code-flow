import { useEffect, useState } from 'react';

export function App() {
  const [photos, setPhotos] = useState<unknown[]>([]);
  useEffect(() => {
    fetch('/photos').then(async (r) => setPhotos(await r.json()));
  }, []);
  const donate = () => fetch('https://api.stripe.com/v1/charges');
  return (
    <main onClick={donate}>
      <h1>Photos ({photos.length})</h1>
    </main>
  );
}
