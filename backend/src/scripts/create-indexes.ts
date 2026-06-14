import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Order } from '../modules/orders/order.model';
import { Product } from '../modules/products/product.model';
import { User } from '../modules/auth/user.model';
import { Store } from '../modules/stores/store.model';

dotenv.config();

/**
 * Create database indexes for optimal query performance
 */
async function createIndexes() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    console.log('Connected to MongoDB');

    console.log('\n📊 Creating indexes...\n');

    // Orders collection indexes
    console.log('Creating Orders indexes...');
    await Order.collection.createIndex({ createdAt: 1, status: 1 });
    console.log('✓ Created index: { createdAt: 1, status: 1 }');
    
    await Order.collection.createIndex({ customerId: 1, createdAt: -1 });
    console.log('✓ Created index: { customerId: 1, createdAt: -1 }');
    
    await Order.collection.createIndex({ status: 1, createdAt: -1 });
    console.log('✓ Created index: { status: 1, createdAt: -1 }');

    // Products collection indexes
    console.log('\nCreating Products indexes...');
    await Product.collection.createIndex({ categoryId: 1 });
    console.log('✓ Created index: { categoryId: 1 }');
    
    await Product.collection.createIndex({ stock: 1 });
    console.log('✓ Created index: { stock: 1 }');

    // Users collection indexes
    console.log('\nCreating Users indexes...');
    await User.collection.createIndex({ createdAt: 1 });
    console.log('✓ Created index: { createdAt: 1 }');
    
    // Note: lastLoginAt field doesn't exist yet, will be added when implementing active users tracking
    // await User.collection.createIndex({ lastLoginAt: -1 });
    // console.log('✓ Created index: { lastLoginAt: -1 }');

    // Stores collection indexes — Stripe billing fields
    console.log('\nCreating Stores (Stripe billing) indexes...');
    await Store.collection.createIndex(
      { stripeCustomerId: 1 },
      { sparse: true, unique: true, name: 'stores_stripeCustomerId_sparse_unique' }
    );
    console.log('✓ Created index: stores.stripeCustomerId (sparse unique)');

    await Store.collection.createIndex(
      { stripeSubscriptionId: 1 },
      { sparse: true, unique: true, name: 'stores_stripeSubscriptionId_sparse_unique' }
    );

    console.log('✓ Created index: stores.stripeSubscriptionId (sparse unique)');

    console.log('\n✅ All indexes created successfully!');
    
    // List all indexes
    console.log('\n📋 Current indexes:\n');
    
    const orderIndexes = await Order.collection.indexes();
    console.log('Orders:', orderIndexes.map(idx => idx.name).join(', '));
    
    const productIndexes = await Product.collection.indexes();
    console.log('Products:', productIndexes.map(idx => idx.name).join(', '));
    
    const storeIndexes = await Store.collection.indexes();
    console.log('Stores:', storeIndexes.map(idx => idx.name).join(', '));

    const userIndexes = await User.collection.indexes();
    console.log('Users:', userIndexes.map(idx => idx.name).join(', '));

  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run the script
createIndexes();
