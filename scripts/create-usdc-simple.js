const SECRET_KEY = 'SBGZTWJVE5XC5XITKID2SWGR7SGLFRMO65YHRDYRNVQEIP2TYKAYYSSZ';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

const keypair = Keypair.fromSecret(SECRET_KEY);
const publicKey = keypair.publicKey();

console.log('Cuenta:', publicKey);

async function horizonGet(path) {
  const response = await fetch(`${HORIZON_URL}${path}`);
  if (!response.ok) throw new Error(`Horizon error: ${response.status} ${await response.text()}`);
  return response.json();
}

async function horizonPost(path, body) {
  const response = await fetch(`${HORIZON_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Horizon error: ${response.status} ${await response.text()}`);
  return response.json();
}

async function main() {
  // 1. Obtener la cuenta
  const account = await horizonGet(`/accounts/${publicKey}`);
  console.log('Secuencia:', account.sequence);
  
  // 2. Verificar si ya existe línea de confianza para USDC
  const usdcAsset = { code: 'USDC', issuer: publicKey };
  const hasTrustline = account.balances.some(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === publicKey
  );
  
  if (!hasTrustline) {
    console.log('Creando línea de confianza para USDC...');
    // Necesitamos crear una transacción con changeTrust
    // Para simplificar, vamos a hacer un payment directamente que creará el activo
  }
  
  // 3. Para crear un activo clásico en Stellar, hacemos un payment de la cuenta a sí misma
  // Primero necesitamos establecer una línea de confianza para nuestro propio activo
  
  console.log('\n--- Para crear el activo USDC clásico: ---');
  console.log('1. Crear línea de confianza para USDC:miCuenta');
  console.log('2. Hacer un payment de USDC de mi cuenta a mí misma');
  console.log('');
  console.log('Luego envolver en SAC:');
  console.log('stellar contract asset deploy --asset "USDC:' + publicKey + '" --source-account escrow_deployer --network testnet --alias usdc_testnet');
  
  // 3. Intentar crear la línea de confianza usando una transacción XDR
  // Para simplificar, usaremos el stellar-sdk para crear la transacción
  const { Keypair, TransactionBuilder, Asset, Operation } = require('@stellar/stellar-sdk');
  
  const kp = Keypair.fromSecret(SECRET_KEY);
  const updatedAccount = await horizonGet(`/accounts/${publicKey}`);
  
  const usdcAsset = new Asset('USDC', publicKey);
  
  // Crear línea de confianza
  const trustlineTx = new TransactionBuilder(updatedAccount, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: usdcAsset,
        limit: '100000000000',
      })
    )
    .setTimeout(300)
    .build();
  
  kp.sign(trustlineTx);
  
  const trustlineResult = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xdr' },
    body: trustlineTx.toXDR()
  });
  
  if (trustlineResult.ok) {
    const result = await trustlineResult.json();
    console.log('Línea de confianza creada:', result.hash);
  } else {
    const error = await trustlineResult.text();
    console.log('Error creando línea de confianza:', error);
  }
  
  // 4. Hacer payment de USDC
  const updatedAccount2 = await horizonGet(`/accounts/${publicKey}`);
  
  const paymentTx = new TransactionBuilder(updatedAccount2, {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: publicKey,
        asset: usdcAsset,
        amount: '1000000', // 1 USDC
      })
    )
    .setTimeout(300)
    .build();
  
  kp.sign(paymentTx);
  
  const paymentResult = await fetch(`${HORIZON_URL}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xdr' },
    body: paymentTx.toXDR()
  });
  
  if (paymentResult.ok) {
    const result = await paymentResult.json();
    console.log('Payment enviado:', result.hash);
    console.log('✅ Activo clásico USDC creado');
  } else {
    const error = await paymentResult.text();
    console.log('Error en payment:', error);
  }
  
  console.log('');
  console.log('Para envolver en SAC:');
  console.log('stellar contract asset deploy --asset \"USDC:' + publicKey + '\" --source-account escrow_deployer --network testnet --alias usdc_testnet');
}

main().catch(console.error);
