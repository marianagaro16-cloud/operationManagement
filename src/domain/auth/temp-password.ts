/**
 * A temporary password an Admin reads out or writes down for someone.
 *
 * Two plain Spanish words and four digits — "mesa-rojo-4827": easy to say
 * over the phone and to type on a phone, with no letters that look alike.
 * It only has to last until the person signs in, where they must choose
 * their own.
 */

const WORDS = [
  'mesa', 'silla', 'rojo', 'verde', 'azul', 'playa', 'monte', 'nube', 'sol', 'luna',
  'pan', 'queso', 'leche', 'tomate', 'maiz', 'arroz', 'limon', 'mango', 'pera', 'uva',
  'rio', 'lago', 'campo', 'flor', 'arbol', 'hoja', 'piedra', 'fuego', 'viento', 'lluvia',
  'gato', 'perro', 'toro', 'pato', 'oso', 'lobo', 'tigre', 'puma', 'loro', 'pez',
  'casa', 'puerta', 'ventana', 'techo', 'plaza', 'calle', 'puente', 'barco', 'tren', 'avion',
  'libro', 'papel', 'lapiz', 'reloj', 'llave', 'caja', 'bolsa', 'vaso', 'plato', 'taza',
] as const;

/** `random` returns an integer in [0, max). Injected so tests can pin it. */
export function tempPassword(random: (max: number) => number = secureRandom): string {
  const word = () => WORDS[random(WORDS.length)];
  const digits = String(random(10000)).padStart(4, '0');
  return `${word()}-${word()}-${digits}`;
}

function secureRandom(max: number): number {
  // Rejection sampling, so every value is equally likely.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

/** At least 8 characters: what someone chooses for themselves. */
export const MIN_PASSWORD_LENGTH = 8;
