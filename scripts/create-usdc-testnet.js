/**
 * Script para crear un activo USDC clásico en Stellar testnet
 * y envolverlo en un SAC (Stellar Asset Contract)
 * 
 * Para usar:
 * 1. Obtener la secret key de tu cuenta deployer
 * 2. Ejecutar: node scripts/create-usdc-testnet.js
 */

import { Keypair, StrKey, Address, scValToNative, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';

// Configuración - usa tu propia secret key
const SECRET_KEY = process.env.STELLAR_SECRET_KEY || 'SBGZTWJVE5XC5XITKID2SWGR7SGLFRMO65YHRDYRNVQEIP2TYKAYYSSZ';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL = 'https://soroban-testnet.stellar.org';

async function main() {
  const keypair = Keypair.fromSecret(SECRET_KEY);
  const publicKey = keypair.publicKey();
  console.log('🔑 Usando cuenta:', publicKey);

  const { Server, TransactionBuilder, Networks, Asset, Operation, Memo } = await import('@stellar/stellar-sdk');
  const server = new Server(RPC_URL, { allowHttp: true });

  try {
    // 1. Obtener la cuenta actual
    const account = await server.accounts().accountId(publicKey).call();
    console.log('📋 Cuenta encontrada:', account.account_id);
    console.log('📋 Secuencia:', account.sequence);

    // 2. Verificar si ya existe una línea de confianza para USDC:miCuenta
    const usdcAsset = new Asset('USDC', publicKey);
    const hasTrustline = account.balances.some(
      (b: any) => b.asset_code === 'USDC' && b.asset_issuer === publicKey
    );

    if (!hasTrustline) {
      console.log('\n🔗 Creando línea de confianza para USDC...');
      // El emisor también necesita una línea de confianza para recibir su propio activo
      const trustlineTx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.changeTrust({
            asset: usdcAsset,
            limit: '100000000000', // 100 mil millones
          })
        )
        .setTimeout(300)
        .build();

      trustlineTx.sign(keypair);
      const trustlineResult = await server.submitTransaction(trustlineTx);
      console.log('✅ Línea de confianza creada:', trustlineResult.hash);
    } else {
      console.log('✅ Línea de confianza ya existe');
    }

    // 3. Obtener la cuenta actualizada para hacer el payment
    const updatedAccount = await server.accounts().accountId(publicKey).call();

    // 4. Hacer un payment de mi cuenta a mí misma con USDC
    // Esto crea el activo clásico en la cadena
    console.log('\n💸 Haciendo payment de USDC (creando activo clásico)...');
    const paymentTx = new TransactionBuilder(updatedAccount, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: publicKey,
          asset: usdcAsset,
          amount: '1000000', // 1 USDC (7 decimales)
        })
      )
      .setTimeout(300)
      .build();

    paymentTx.sign(keypair);
    const paymentResult = await server.submitTransaction(paymentTx);
    console.log('✅ Payment enviado:', paymentResult.hash);
    console.log('✅ Activo clásico USDC creado en la cadena');

    // 5. Envolver el activo clásico en un SAC usando stellar-cli
    console.log('\n📦 Para envolver el activo clásico en un SAC:');
    console.log('');
    console.log('  stellar contract asset deploy \\');
    console.log('    --asset "USDC:' + publicKey + '" \\');
    console.log('    --source-account escrow_deployer \\');
    console.log('    --network testnet \\');
    console.log('    --alias usdc_testnet');
    console.log('');
    console.log('Luego usa ese SAC como el usdc_sac en el contrato de escrow.');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

main().catch(console.error);
