const { Keypair, Server, TransactionBuilder, Networks, Asset, Operation, Memo, StrKey } = require('@stellar/stellar-sdk');

async function main() {
  const SECRET_KEY = 'SBGZTWJVE5XC5XITKID2SWGR7SGLFRMO65YHRDYRNVQEIP2TYKAYYSSZ';
  const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
  
  const keypair = Keypair.fromSecret(SECRET_KEY);
  const publicKey = keypair.publicKey();
  console.log('Cuenta:', publicKey);
  
  const server = new Server('https://horizon-testnet.stellar.org', { allowHttp: true });
  
  // 1. Obtener la cuenta
  const account = await server.accounts().accountId(publicKey).call();
  console.log('Secuencia:', account.sequence);
  
  // 2. Verificar si ya existe línea de confianza para USDC
  const usdcAsset = new Asset('USDC', publicKey);
  const hasTrustline = account.balances.some(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === publicKey
  );
  
  if (!hasTrustline) {
    console.log('Creando línea de confianza para USDC...');
    const trustlineTx = new TransactionBuilder(account, {
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
    
    trustlineTx.sign(keypair);
    const trustlineResult = await server.submitTransaction(trustlineTx);
    console.log('Línea de confianza creada:', trustlineResult.hash);
  } else {
    console.log('Línea de confianza ya existe');
  }
  
  // 3. Hacer un payment de mi cuenta a mí misma con USDC
  const updatedAccount = await server.accounts().accountId(publicKey).call();
  
  console.log('Haciendo payment de USDC...');
  const paymentTx = new TransactionBuilder(updatedAccount, {
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
  
  paymentTx.sign(keypair);
  const paymentResult = await server.submitTransaction(paymentTx);
  console.log('Payment enviado:', paymentResult.hash);
  console.log('✅ Activo clásico USDC creado en la cadena');
  
  console.log('');
  console.log('Para envolver en SAC:');
  console.log('stellar contract asset deploy --asset \"USDC:' + publicKey + '\" --source-account escrow_deployer --network testnet --alias usdc_testnet');
}

main().catch(console.error);
