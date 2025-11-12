// Script para migrar productos iniciales a Firestore
// Ejecutar con: node seed-products.js

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const productos = [
  {
    id: "paquete-inicio",
    nombre: "Paquete Inicial – 15 kg",
    descripcion: "Incluye 15 kilos de chuletas, costillas y paticas empacadas al vacío.",
    imagen: "../images/productos/inicio.jpg",
    precioDistribuidor: 300000,
    precioCliente: 375000,
    precioRestaurante: null,
    precio: 300000,
    puntos: 50,
    unit: "paquete",
    availableFor: ["distribuidor", "cliente"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "chuletas-3kg",
    nombre: "Chuletas – 3 kg",
    descripcion: "Chuletas frescas y jugosas, empacadas al vacío.",
    imagen: "../images/productos/chuleta.jpg",
    precioDistribuidor: 60000,
    precioCliente: 75000,
    precioRestaurante: null,
    precio: 60000,
    puntos: 10,
    unit: "paquete",
    availableFor: ["distribuidor", "cliente"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "costillas-3kg",
    nombre: "Costillitas – 3 kg",
    descripcion: "Costillitas tiernas y llenas de sabor.",
    imagen: "../images/productos/costillas.jpg",
    precioDistribuidor: 60000,
    precioCliente: 75000,
    precioRestaurante: null,
    precio: 60000,
    puntos: 10,
    unit: "paquete",
    availableFor: ["distribuidor", "cliente"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "paticas-3kg",
    nombre: "Paticas – 3 kg",
    descripcion: "Paticas perfectas para caldos y guisos.",
    imagen: "../images/productos/paticas.jpg",
    precioDistribuidor: 60000,
    precioCliente: 75000,
    precioRestaurante: null,
    precio: 60000,
    puntos: 10,
    unit: "paquete",
    availableFor: ["distribuidor", "cliente"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "panceta-3kg",
    nombre: "Panceta – 3 kg",
    descripcion: "Panceta fresca empacada al vacío.",
    imagen: "../images/productos/inicio.jpg",
    precioDistribuidor: 60000,
    precioCliente: 75000,
    precioRestaurante: null,
    precio: 60000,
    puntos: 10,
    unit: "paquete",
    availableFor: ["distribuidor", "cliente"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "pulpa-3kg",
    nombre: "Pulpa – 3 kg",
    descripcion: "Pulpa de cerdo empacada al vacío.",
    imagen: "../images/productos/inicio.jpg",
    precioDistribuidor: 60000,
    precioCliente: 75000,
    precioRestaurante: null,
    precio: 60000,
    puntos: 10,
    unit: "paquete",
    availableFor: ["distribuidor", "cliente"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "goulast-3kg",
    nombre: "Goulast – 3 kg",
    descripcion: "Goulast de cerdo empacado al vacío.",
    imagen: "../images/productos/inicio.jpg",
    precioDistribuidor: 60000,
    precioCliente: 75000,
    precioRestaurante: null,
    precio: 60000,
    puntos: 10,
    unit: "paquete",
    availableFor: ["distribuidor", "cliente"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "chuleta-kilo",
    nombre: "Chuleta por Kilo",
    descripcion: "Chuletas frescas, vendidas por kilo.",
    imagen: "../images/productos/chuleta.jpg",
    precioDistribuidor: null,
    precioCliente: null,
    precioRestaurante: 20000,
    precio: 20000,
    puntos: 10/3,
    unit: "kilo",
    availableFor: ["restaurante"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "costilla-kilo",
    nombre: "Costilla por Kilo",
    descripcion: "Costillas tiernas, vendidas por kilo.",
    imagen: "../images/productos/costillas.jpg",
    precioDistribuidor: null,
    precioCliente: null,
    precioRestaurante: 20000,
    precio: 20000,
    puntos: 10/3,
    unit: "kilo",
    availableFor: ["restaurante"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "paticas-kilo",
    nombre: "Paticas por Kilo",
    descripcion: "Paticas perfectas para caldos, vendidas por kilo.",
    imagen: "../images/productos/paticas.jpg",
    precioDistribuidor: null,
    precioCliente: null,
    precioRestaurante: 20000,
    precio: 20000,
    puntos: 10/3,
    unit: "kilo",
    availableFor: ["restaurante"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "panceta-kilo",
    nombre: "Panceta por Kilo",
    descripcion: "Panceta fresca, vendida por kilo.",
    imagen: "../images/productos/inicio.jpg",
    precioDistribuidor: null,
    precioCliente: null,
    precioRestaurante: 20000,
    precio: 20000,
    puntos: 10/3,
    unit: "kilo",
    availableFor: ["restaurante"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "pulpa-kilo",
    nombre: "Pulpa por Kilo",
    descripcion: "Pulpa de cerdo, vendida por kilo.",
    imagen: "../images/productos/inicio.jpg",
    precioDistribuidor: null,
    precioCliente: null,
    precioRestaurante: 20000,
    precio: 20000,
    puntos: 10/3,
    unit: "kilo",
    availableFor: ["restaurante"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  },
  {
    id: "goulast-kilo",
    nombre: "Goulast por Kilo",
    descripcion: "Goulast de cerdo, vendido por kilo.",
    imagen: "../images/productos/inicio.jpg",
    precioDistribuidor: null,
    precioCliente: null,
    precioRestaurante: 20000,
    precio: 20000,
    puntos: 10/3,
    unit: "kilo",
    availableFor: ["restaurante"],
    categoria: "carnes",
    hidden: false,
    outOfStock: false,
    deleted: false
  }
];

async function seedProducts() {
  console.log('Starting product migration...');
  
  try {
    for (const product of productos) {
      await db.collection('productos').add(product);
      console.log(`✓ Added: ${product.nombre}`);
    }
    
    console.log('\n✅ All products migrated successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error migrating products:', error);
    process.exit(1);
  }
}

seedProducts();
