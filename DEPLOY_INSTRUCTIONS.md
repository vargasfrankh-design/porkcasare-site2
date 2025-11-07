# 🔥 Instrucciones para Desplegar Reglas de Firestore

## Problema Actual
Las reglas de Firestore están configuradas correctamente en el archivo local `firestore.rules`, pero **NO ESTÁN DESPLEGADAS** en el servidor de Firebase. Esto causa el error "Missing or insufficient permissions" incluso cuando el usuario tiene el rol de admin.

## Solución: Desplegar las Reglas

### Opción 1: Usar Firebase CLI (Recomendado)

#### Paso 1: Instalar Firebase CLI
```bash
npm install -g firebase-tools
```

#### Paso 2: Iniciar Sesión en Firebase
```bash
firebase login
```
Esto abrirá tu navegador para autenticarte con tu cuenta de Google que tiene acceso al proyecto.

#### Paso 3: Verificar el Proyecto
```bash
firebase use
```
Debe mostrar: `porkcasare-915ff` (default)

#### Paso 4: Desplegar las Reglas
```bash
firebase deploy --only firestore:rules
```

#### Paso 5: Verificar el Despliegue
Después de ejecutar el comando, deberías ver:
```
✔ Deploy complete!

Project Console: https://console.firebase.google.com/project/porkcasare-915ff/overview
```

### Opción 2: Usar la Consola de Firebase (Alternativa)

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Selecciona el proyecto **porkcasare-915ff**
3. En el menú lateral, ve a **Firestore Database**
4. Haz clic en la pestaña **Rules** (Reglas)
5. Copia todo el contenido del archivo `firestore.rules` local
6. Pégalo en el editor de la consola
7. Haz clic en **Publish** (Publicar)

## Verificación Final

### 1. Verificar en Firebase Console
- Ve a Firestore Database → Rules
- Verifica que la fecha de publicación sea reciente
- Asegúrate de que las reglas incluyan:
  ```javascript
  function isAdmin() {
    return isAuthenticated() && 
           exists(/databases/$(database)/documents/usuarios/$(request.auth.uid)) &&
           (get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.rol == 'admin' ||
            get(/databases/$(database)/documents/usuarios/$(request.auth.uid)).data.role == 'admin');
  }
  ```

### 2. Verificar el Documento de Usuario
- Ve a Firestore Database → Data
- Busca la colección **usuarios**
- Busca el documento con ID: **7ott6X1yAdRuYNbJ69H466dkG2J3**
- Verifica que tenga el campo: `rol: "admin"` o `role: "admin"`

### 3. Probar el Admin Panel
1. Recarga la página `admin.html`
2. Inicia sesión con las credenciales del administrador
3. El inventario debería cargarse sin errores

## Archivos Configurados

Los siguientes archivos ya están correctamente configurados en el proyecto:

- ✅ `firestore.rules` - Reglas de seguridad de Firestore
- ✅ `firebase.json` - Configuración de Firebase
- ✅ `.firebaserc` - Configuración del proyecto Firebase (RECIÉN CREADO)

## Posibles Problemas

### Problema: "You are not logged in"
**Solución:** Ejecuta `firebase login` y sigue las instrucciones

### Problema: "Permission denied"
**Solución:** Asegúrate de tener permisos de Editor/Propietario en el proyecto de Firebase

### Problema: Las reglas se desplegaron pero sigue el error
**Solución:** 
1. Espera 1-2 minutos (las reglas tardan en propagarse)
2. Cierra sesión y vuelve a iniciar sesión en admin.html
3. Verifica que el documento del usuario exista en Firestore

## Información del Proyecto

- **Project ID:** porkcasare-915ff
- **Usuario Admin UID:** 7ott6X1yAdRuYNbJ69H466dkG2J3
- **Colección Usuarios:** usuarios
- **Campo de Rol:** rol (o role)
