/**
 * Loads the office manual ("Manual oficina (APP).docx") into the Guides: the
 * daily points of Mariana's guide, the reference articles — the delivery-note
 * how-to with its screenshots — and how to order from the cheese suppliers.
 *
 *   node scripts/seed-office-guide.mjs <folder with the manual's image1.png … image11.png>
 *
 * Run once. It refuses to run again when the guide already has points, so
 * what was corrected in the app afterwards is never overwritten.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config({ path: '.env', quiet: true });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const media = process.argv[2];
if (!media) {
  console.error('Give the folder with the manual\'s images.');
  process.exit(1);
}

const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
};

const owner = must(
  await admin.from('profiles').select('id').eq('name', 'Mariana García').eq('status', 'approved').single(),
  'the guide\'s person',
).id;
const supplier = async (name) => must(await admin.from('suppliers').select('id').eq('name', name).single(), name).id;
const intercheese = await supplier('Intercheese');
const stofel = await supplier('Käserei Stofel');

const existing = must(await admin.from('guide_points').select('id').eq('guide_id', owner).limit(1), 'existing points');
if (existing.length > 0) {
  console.error('This guide already has points. Nothing was changed.');
  process.exit(1);
}

/* -------------------------------- articles ------------------------------- */

const H = (text) => ({ type: 'heading', text });
const T = (text) => ({ type: 'text', text });

async function article(topic, title, sort_order, build) {
  const id = randomUUID();
  const image = async (n) => {
    const path = `${id}/paso-${n}.png`;
    must(
      await admin.storage.from('guide-files').upload(path, readFileSync(join(media, `image${n}.png`)), { contentType: 'image/png' }),
      `image ${n}`,
    );
    return { type: 'image', path };
  };
  must(await admin.from('guide_articles').insert({ id, topic, title, sort_order, blocks: await build(image), created_by: owner, updated_by: owner }), title);
  return id;
}

const deliveryNote = await article('Bexio', 'Cómo crear una nota de entrega', 10, async (image) => [
  T('Ir a la viñeta «Sales» y presionar «Orders».'),
  await image(1),
  H('1. ¿El cliente ya tiene una cuenta abierta?'),
  T('Verificar que no haya alguna cuenta abierta con ese cliente.'),
  await image(2),
  T('- Si no la hay: crear una nota de entrega a su nombre y verificar que la dirección de entrega esté correcta.\n- Si la hay: continuar agregando producto a la cuenta abierta que tiene.'),
  H('2. Escribir la fecha del pedido'),
  T('Presionar «+ More items» y después «Text position».'),
  await image(3),
  T('Escribir «Auftrag vom 00.00.2025» o «Order from 00.00.2025» y guardar. En alemán para la parte alemana de Suiza; para el resto, en inglés.'),
  await image(4),
  await image(5),
  H('3. Agregar los productos'),
  T('Para agregar un producto a la cuenta abierta, presionar «+ Add item» y después «Product position».'),
  await image(6),
  H('4. Crear la nota de entrega'),
  T('Cuando ya queremos finalizar la nota de entrega, presionar «Create delivery».'),
  await image(7),
  T('Seleccionar los productos que queremos agregar a la nota de entrega y guardar.'),
  await image(8),
  T('Ojo: siempre presionar «Mark delivery as done» para que el producto salga del sistema.'),
  await image(9),
  H('5. Imprimir'),
  T('Imprimir la nota de entrega.'),
  await image(10),
  await image(11),
]);

await article('Bexio', 'Reglas de Bexio', 20, async () => [
  H('Nunca borrar nada'),
  T('- No borrar facturas ni notas de pedido.\n- Si se cancela una nota de pedido o una factura, avisar por mail al equipo explicando brevemente el motivo por el que se tomó esta decisión.\n- Todo debe quedar registrado en el sistema para poder mantener un seguimiento claro de los cambios y cancelaciones.'),
  H('Rondín final: columna «Reserved»'),
  T('Entrar a Bexio → Products → Inventory.\nRevisar la columna «Reserved» y verificar que todos los productos estén en 0.\nSi aparece algún número positivo, comprobar que corresponda a un pedido que todavía esté pendiente de entrega de producto. Si no corresponde a ningún pedido pendiente, revisar el motivo para asegurarnos de que el inventario esté correcto.'),
]);

await article('Envíos', 'Clientes: día de entrega, método de envío y facturación', 10, async () => [
  {
    type: 'table',
    rows: [
      ['Cliente', 'Día de entrega', 'Método de envío', 'Facturación'],
      ['Taquerías', 'Lunes y viernes', 'Palomo', 'Fin de mes'],
      ['La Catedral', 'Viernes', 'Palomo', 'Fin de mes'],
      ['Clientes que estén en Zürich City', 'Miércoles', 'Palomo', 'Depende del cliente'],
      ['Clientes que estén fuera de Zürich (caja)', 'Lunes a jueves', 'DHL\nMurpf (refrigerado / congelado)', 'Depende del cliente'],
      ['Clientes (por pallet)', 'Lunes a jueves', 'Murpf (refrigerado / congelado) / Fracht / DB Schenker / Planzer', 'Depende del cliente'],
      ['Cliente (extranjero)', 'Lunes a viernes', 'Fracht / Dachser', 'Antes de enviar el pedido'],
      ['Emmi', 'Según planificación', 'Emmi', 'Fin de mes'],
      ['EMS', 'Lunes a viernes', 'Lunes a jueves: DHL\nViernes: Die Post (entrega el sábado)', 'Fin de mes'],
    ],
  },
]);

await article('Envíos', 'Tarifas de envío y pedido mínimo', 20, async () => [
  H('Clientes de Bexio fuera de Zúrich (DHL / Murpf / Planzer)'),
  T('- Hasta 12 kg: 13.90 CHF\n- Hasta 24 kg: 15.90 CHF'),
  H('Envío gratuito'),
  T('- Clientes Gastro: pedido mínimo de 650 CHF (por sucursal).\n- Clientes Retail: pedido mínimo de 350 CHF (por sucursal).\n- Clientes Distribuidor: pedido mínimo de 1500 CHF.\n- Entrega en fábrica: se aplica el 3 % de descuento.'),
  H('Recargo por pedido mínimo'),
  T('Aplicar una tarifa adicional al cliente gastro fuera de la ciudad de Zúrich cuando no alcance el consumo mínimo de pedido de 100 CHF. El producto a utilizar en Bexio se llama «Mindestbestellwert Zuschlag» y el monto es de 9.90 CHF.'),
]);

await article('Envíos', 'Entrega de pedidos con IFCO', 30, async () => [
  T('Los siguientes clientes reciben sus pedidos con IFCO:\n- Las Taquerías\n- La Catedral\n- Santaco'),
]);

await article('Envíos', 'Registro de documentos Emmi', 40, async () => [
  T('Registrar el historial de Emmi en la carpeta de transportistas externos.'),
  T('A partir de octubre de 2025 solo se debe enviar el archivo «Avisierungsformular Import SAP Colectivo Anónimo GmbH».\nEste archivo debe enviarse por e-mail antes del mediodía para que la recolección se realice al día siguiente.\nDentro del propio archivo se especifican los correos electrónicos de destino.'),
]);

const oil = await article('Proveedores', 'Recogida del aceite usado (Josef)', 10, async () => [
  T('Verificar el nivel de llenado del contenedor de aceite. Si está lleno, contactar a Josef por WhatsApp para solicitar la recogida: +41 79 266 38 36.'),
  T('Josef realiza las recogidas únicamente los miércoles por la mañana.'),
]);

/* ---------------------------- supplier cards ----------------------------- */

must(
  await admin.from('supplier_order_info').upsert([
    {
      supplier_id: intercheese,
      how: 'Enviar el pedido de queso Chihuahua por e-mail.',
      contact: 'info@intercheese.ch',
      minimum: '204 kg',
      deadline: 'Viernes, antes de las 10:00',
      updated_by: owner,
    },
    {
      supplier_id: stofel,
      how: 'Enviar por WhatsApp a Thomas (el quesero) el pedido de queso Fresco, Oaxaca y Panela.\nRegistrar el pedido de queso en Bexio, en la carpeta de proveedores.',
      contact: 'Thomas, por WhatsApp',
      minimum: '15 kg por tipo de queso',
      deadline: 'Miércoles',
      updated_by: owner,
    },
  ]),
  'supplier cards',
);

/* --------------------------------- guide --------------------------------- */

must(
  await admin.from('guides').upsert({
    profile_id: owner,
    intro: 'Lo que hay que hacer cada día en la oficina, en el orden en que se hace. Los pasos de Bexio, las tarifas y los envíos están en la pestaña Artículos.',
    day_notes: {
      1: '6 ½ personas',
      2: '6 ½ personas',
      3: 'Alterna cada dos semanas: miércoles Azul (6 personas) / miércoles Gastro Taquerías (5 personas)',
      4: '8 personas',
    },
    created_by: owner,
    updated_by: owner,
  }),
  'guide',
);

const WEEK = [1, 2, 3, 4, 5];
const BRIEFING =
  'Por ejemplo: preparación de pedidos, recolección de tanques de gas y cualquier otro aspecto relevante para la ejecución de sus tareas.\nComo apoyo, puede utilizarse el archivo «Actividades de logística _ mes».';
const EMS =
  'Si los hay, agregar los pedidos a la app, imprimir los packing slips de los pedidos ingresados antes de las 3:00 p. m. y marcarlos como Fulfilled en Shopify.';

/** [order, weekdays, title, extras] */
const points = [
  [5, WEEK, 'Bexio: nunca borrar nada', {
    kind: 'rule',
    body: 'No borrar facturas ni notas de pedido. Si se cancela una nota de pedido o una factura, avisar por mail al equipo explicando brevemente el motivo. Todo debe quedar registrado en el sistema.',
  }],
  [10, [1, 5], 'Verificar el nivel de llenado de los tanques de gas', {
    body: 'Si hay más de un tanque vacío, coordinar con la persona que hace las entregas ese día para que realice el surtido de los tanques lo antes posible.',
  }],
  [20, WEEK, 'Revisar los e-mails (sin responder por ahora) y anotar los pedidos en la app', {}],
  [25, [1], 'Revisar las fechas de caducidad del inventario de Masamor de la semana anterior', {
    body: 'Tomarlo en consideración al crear el plan de producción. Tomar acción en caso de ser necesario, p. ej. sacar producto del inventario y pasarlo a Too Good To Go.',
  }],
  [30, [1], 'Elaborar el plan de producción de Tortilla Chip, imprimirlo y comunicar los detalles importantes del día al encargado del turno', { deadline: '07:30' }],
  [30, [2, 3, 4, 5], 'Realizar las correcciones necesarias al plan de producción del día, imprimirlo y explicarlo al encargado del turno', { deadline: '07:00' }],
  [40, WEEK, 'Briefing con la persona encargada de logística sobre las actividades del día', { body: BRIEFING }],
  [50, WEEK, 'Revisar si hay pedidos de EMS en Shopify', { body: EMS }],
  [55, WEEK, 'Ingresar los pedidos de productos de Del Barrio y Colectivo Comestibles en el control de pedidos', {
    body: 'Para encontrar el archivo: Operaciones → Control de pedidos → carpeta Del Barrio / Colectivo Comestibles.\nRegistrar el producto que haya llegado junto con su fecha de caducidad y número de nota de entrega.',
  }],
  [60, WEEK, 'Añadir a Bexio los productos registrados en el «control de producción» de la jornada anterior', {}],
  [62, [3], 'Registrar con anticipación en Bexio todos los productos de tortilla azul que deban salir del sistema el mismo día', {
    body: 'Tortilla azul de 14 cm, 12 cm, 10 cm y cualquier otro diámetro, según el plan de producción.\nSolo el miércoles Azul.',
  }],
  [64, [3], 'Registrar el pedido de queso en Bexio, en la carpeta de proveedores', { supplier_id: stofel }],
  [70, WEEK, 'Crear e imprimir las notas de entrega en Bexio para los pedidos del día', {
    body: 'Masamor, Del Barrio y EMS (las de EMS no se imprimen).',
    article_id: deliveryNote,
  }],
  [72, [5], 'Generar las etiquetas de Die Post para los envíos de EMS', {
    deadline: '09:00',
    body: 'El User de logística prepara el pedido y hace la entrega en la Post: tener las etiquetas listas antes de las 9:00.',
  }],
  [74, [5], 'Enviar el pedido de Chihuahua por mail a info@intercheese.ch', { deadline: '10:00', body: 'Mínimo de pedido: 204 kg.', supplier_id: intercheese }],
  [80, [1], 'Elaborar el plan de producción del martes y comunicar el número de costales al encargado de producción', {
    body: 'Considerar los pedidos del martes, miércoles y jueves, 500 g – 14 cm y Emmi.',
  }],
  [80, [2], 'Elaborar el plan de producción del miércoles y comunicar el número de costales al encargado de producción', {
    body: 'Si la producción es de Tortilla Azul, producir:\n- Lo solicitado por los clientes\n- Reservas internas: 500 g / 14 cm para EMS (aprox. 20 paquetes), tortilla para freír cortada, masa, tortilla 14 cm al vacío para freír\n\nSi la producción es de Tortilla Amarilla, producir:\n- Reservas internas: tortilla 12 cm empaque fresco, tlayuda',
  }],
  [80, [3], 'Elaborar el plan de producción del jueves y comunicar el número de costales al encargado de producción', {
    body: 'Considerar los pedidos del jueves, viernes y lunes, El Catrín + reserva 1 kg, 14 cm, 500 g 12 cm, 500 g 10 cm.\nEscribir también en las notas del plan de producción del jueves: poner 20 cartones en pallet; el resto en IFCO + cartón.',
  }],
  [80, [4], 'Elaborar el plan de producción del viernes y comunicar el número de costales al encargado de producción', {}],
  [90, WEEK, 'Realizar el pedido de transporte para los pedidos que se envían por pallet', { deadline: '12:00' }],
  [100, [1], 'Generar las etiquetas de DHL para los envíos de Bexio (fuera de Zúrich) y EMS (toda Suiza)', {}],
  [100, [2, 3, 4], 'Generar las etiquetas de DHL para los envíos de Masamor y Del Barrio (fuera de Zúrich) y EMS (toda Suiza)', {}],
  [110, WEEK, 'Responder los e-mails', {}],
  [120, [1, 3], 'Revisar el stock de los productos de los proveedores (Pistor, Pacovis, etc.)', {
    body: 'Evaluar si es necesario realizar un nuevo pedido durante la ausencia de Freddy.',
  }],
  [122, [2], 'Verificar el nivel de llenado del contenedor de aceite', {
    body: 'Si está lleno, contactar a Josef por WhatsApp para solicitar la recogida: +41 79 266 38 36. Él recoge únicamente los miércoles por la mañana.',
    article_id: oil,
  }],
  [124, [3], 'Enviar por WhatsApp el pedido de queso Fresco, Oaxaca y Panela a Thomas (el quesero)', {
    body: 'El pedido mínimo por tipo de queso es de 15 kg.',
    supplier_id: stofel,
  }],
  [126, [4], 'Realizar el inventario digital de Complementarios / Colectivo Comestibles', { body: 'Solo el segundo jueves y el último jueves del mes.' }],
  [128, [4], 'Programar el inventario físico de Empaques / Materia prima', { body: 'Solo el último jueves del mes.' }],
  [130, [5], 'Realizar el inventario digital de Masamor / Del Barrio', { body: 'Semanal.' }],
  [135, [5], 'Empezar el plan de producción del lunes', {}],
  [140, WEEK, 'Supervisar el inventario de productos EMS en Shopify', { body: 'Sara es la responsable principal.' }],
  [145, [3], 'Si Bridge hace pedido de los productos de Colectivo Comestibles, ajustar el inventario en Shopify', {}],
  [150, WEEK, 'Rondín final: revisar la columna «Reserved» en Bexio', {
    body: 'Bexio → Products → Inventory. Todos los productos deben estar en 0.\nSi aparece algún número positivo, comprobar que corresponda a un pedido todavía pendiente de entrega. Si no corresponde a ninguno, revisar el motivo para asegurarnos de que el inventario esté correcto.',
  }],
];

must(
  await admin.from('guide_points').insert(
    points.map(([sort_order, weekdays, title, extra]) => ({
      guide_id: owner,
      kind: 'task',
      weekdays,
      title,
      sort_order,
      body: null,
      deadline: null,
      article_id: null,
      supplier_id: null,
      created_by: owner,
      updated_by: owner,
      ...extra,
    })),
  ),
  'points',
);

console.log(`Loaded: ${points.length} points, 7 articles, 2 supplier cards.`);
