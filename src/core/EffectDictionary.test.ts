/**
 * EffectDictionary Test Suite
 *
 * Tests:
 * - Effect registration and ID stability
 * - localStorage persistence
 * - Name collision handling
 * - Export functionality
 * - Cross-session persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EffectDictionary } from './EffectDictionary';

describe('EffectDictionary', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    // Mock localStorage
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (index: number) => Object.keys(store)[index] ?? null,
    });

    EffectDictionary.clear();
  });

  afterEach(() => {
    EffectDictionary.clear();
    vi.unstubAllGlobals();
  });

  describe('Registration', () => {
    it('should register new effects and return unique IDs', () => {
      const dict = EffectDictionary.getInstance();

      const id1 = dict.register('particle', 'Test Effect 1', 'TestSource');
      const id2 = dict.register('explosion', 'Test Effect 2', 'TestSource');

      expect(id1).toBe(0);
      expect(id2).toBe(1);
      expect(id1).not.toBe(id2);
    });

    it('should return same ID for duplicate effect names', () => {
      const dict = EffectDictionary.getInstance();

      const id1 = dict.register('particle', 'Test Effect', 'Source1');
      const id2 = dict.register('particle', 'Test Effect', 'Source2'); // Same name, different source

      expect(id1).toBe(id2);
    });

    it('should store effect descriptors with all metadata', () => {
      const dict = EffectDictionary.getInstance();

      const metadata = {
        color: 'red',
        size: 10,
      };
      const id = dict.register('particle', 'Red Particle', 'ParticleSystem', metadata);

      const descriptor = dict.get(id);
      expect(descriptor).not.toBeNull();
      expect(descriptor!.type).toBe('particle');
      expect(descriptor!.name).toBe('Red Particle');
      expect(descriptor!.source).toBe('ParticleSystem');
      expect(descriptor!.metadata).toEqual(metadata);
      expect(descriptor!.firstSeen).toBeDefined();
    });

    it('should generate sequential IDs', () => {
      const dict = EffectDictionary.getInstance();

      const id1 = dict.register('particle', 'Effect 1', 'Test');
      const id2 = dict.register('particle', 'Effect 2', 'Test');
      const id3 = dict.register('particle', 'Effect 3', 'Test');

      expect(id1).toBe(0);
      expect(id2).toBe(1);
      expect(id3).toBe(2);
    });
  });

  describe('Lookup', () => {
    it('should retrieve effect by ID', () => {
      const dict = EffectDictionary.getInstance();

      const id = dict.register('explosion', 'Boom', 'Test');
      const descriptor = dict.get(id);

      expect(descriptor).not.toBeNull();
      expect(descriptor!.id).toBe(id);
      expect(descriptor!.name).toBe('Boom');
    });

    it('should retrieve effect ID by name', () => {
      const dict = EffectDictionary.getInstance();

      const id = dict.register('particle', 'My Effect', 'Test');
      const retrievedId = dict.getIdByName('My Effect');

      expect(retrievedId).toBe(id);
    });

    it('should return null for non-existent effect ID', () => {
      const dict = EffectDictionary.getInstance();

      const descriptor = dict.get(999);
      expect(descriptor).toBeNull();
    });

    it('should return null for non-existent effect name', () => {
      const dict = EffectDictionary.getInstance();

      const id = dict.getIdByName('NonExistent');
      expect(id).toBeNull();
    });

    it('should retrieve all registered effects', () => {
      const dict = EffectDictionary.getInstance();

      dict.register('particle', 'Effect 1', 'Test');
      dict.register('explosion', 'Effect 2', 'Test');
      dict.register('aura', 'Effect 3', 'Test');

      const allEffects = dict.getAll();
      expect(allEffects.size).toBe(3);
    });
  });

  describe('Persistence', () => {
    it('should persist to localStorage after batched delay', async () => {
      const dict = EffectDictionary.getInstance();

      dict.register('particle', 'Test Effect', 'Test');

      // Wait for batched save (2 seconds delay)
      await new Promise(resolve => setTimeout(resolve, 2100));
      const stored = localStorage.getItem('gw_effect_dictionary');
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.effects).toHaveLength(1);
      expect(parsed.effects[0].name).toBe('Test Effect');
    });

    it('should flush immediately when requested', () => {
      const dict = EffectDictionary.getInstance();

      dict.register('particle', 'Test Effect', 'Test');
      dict.flush();

      const stored = localStorage.getItem('gw_effect_dictionary');
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.effects).toHaveLength(1);
    });

    it('should load persisted effects on new instance', () => {
      // First instance: register and flush
      const dict1 = EffectDictionary.getInstance();
      dict1.register('particle', 'Effect 1', 'Test');
      dict1.register('explosion', 'Effect 2', 'Test');
      dict1.flush();

      // Force singleton reset without clearing localStorage
      (EffectDictionary as any).instance = null;

      // Second instance: should load from localStorage
      const dict2 = EffectDictionary.getInstance();
      const id1 = dict2.getIdByName('Effect 1');
      const id2 = dict2.getIdByName('Effect 2');

      expect(id1).not.toBeNull();
      expect(id2).not.toBeNull();
      expect(id1).not.toBe(id2);
    });

    it('should preserve ID sequence across sessions', () => {
      // First session
      const dict1 = EffectDictionary.getInstance();
      const id1 = dict1.register('particle', 'Effect 1', 'Test');
      const id2 = dict1.register('explosion', 'Effect 2', 'Test');
      dict1.flush();

      expect(id1).toBe(0);
      expect(id2).toBe(1);

      // Force singleton reset without clearing localStorage
      (EffectDictionary as any).instance = null;

      // Second session: next ID should continue from 2
      const dict2 = EffectDictionary.getInstance();
      const id3 = dict2.register('aura', 'Effect 3', 'Test');

      expect(id3).toBe(2);
    });

    it('should handle corrupt localStorage gracefully', () => {
      // Write corrupt data
      localStorage.setItem('gw_effect_dictionary', 'not valid json');

      // Should not crash and should start fresh
      const dict = EffectDictionary.getInstance();
      const id = dict.register('particle', 'Test', 'Test');

      expect(id).toBe(0); // Fresh start
    });

    it('should handle missing localStorage gracefully', () => {
      // No pre-existing data
      const dict = EffectDictionary.getInstance();
      const id = dict.register('particle', 'Test', 'Test');

      expect(id).toBe(0);
    });
  });

  describe('Export', () => {
    it('should export as JSON with all effect data', () => {
      const dict = EffectDictionary.getInstance();

      dict.register('particle', 'Effect 1', 'Test1', { color: 'red' });
      dict.register('explosion', 'Effect 2', 'Test2', { size: 10 });

      const json = EffectDictionary.exportAsJSON();
      const parsed = JSON.parse(json);

      expect(parsed.effects).toHaveLength(2);
      expect(parsed.nextId).toBe(2);
      expect(parsed.effects[0].name).toBe('Effect 1');
      expect(parsed.effects[0].metadata.color).toBe('red');
      expect(parsed.effects[1].name).toBe('Effect 2');
      expect(parsed.effects[1].metadata.size).toBe(10);
    });

    it('should export valid JSON format', () => {
      const dict = EffectDictionary.getInstance();

      dict.register('particle', 'Test', 'Test');

      const json = EffectDictionary.exportAsJSON();

      // Should be valid JSON
      expect(() => JSON.parse(json)).not.toThrow();

      // Should be pretty-printed (have newlines)
      expect(json).toContain('\n');
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple getInstance calls', () => {
      const dict1 = EffectDictionary.getInstance();
      const dict2 = EffectDictionary.getInstance();

      expect(dict1).toBe(dict2);
    });

    it('should share state across getInstance calls', () => {
      const dict1 = EffectDictionary.getInstance();
      const id1 = dict1.register('particle', 'Shared Effect', 'Test');

      const dict2 = EffectDictionary.getInstance();
      const id2 = dict2.getIdByName('Shared Effect');

      expect(id1).toBe(id2);
    });
  });

  describe('Clear', () => {
    it('should clear all effects from memory', () => {
      const dict = EffectDictionary.getInstance();
      dict.register('particle', 'Effect 1', 'Test');
      dict.register('explosion', 'Effect 2', 'Test');

      EffectDictionary.clear();

      const newDict = EffectDictionary.getInstance();
      expect(newDict.getAll().size).toBe(0);
    });

    it('should clear localStorage', () => {
      const dict = EffectDictionary.getInstance();
      dict.register('particle', 'Effect 1', 'Test');
      dict.flush();

      expect(localStorage.getItem('gw_effect_dictionary')).not.toBeNull();

      EffectDictionary.clear();

      expect(localStorage.getItem('gw_effect_dictionary')).toBeNull();
    });

    it('should reset ID sequence', () => {
      const dict1 = EffectDictionary.getInstance();
      dict1.register('particle', 'Effect 1', 'Test');
      dict1.register('explosion', 'Effect 2', 'Test');

      EffectDictionary.clear();

      const dict2 = EffectDictionary.getInstance();
      const id = dict2.register('aura', 'Effect 3', 'Test');

      expect(id).toBe(0); // Reset to 0
    });
  });

  describe('Metadata', () => {
    it('should store effect timestamp', () => {
      const dict = EffectDictionary.getInstance();
      const before = new Date().toISOString();

      const id = dict.register('particle', 'Test', 'Test');

      const after = new Date().toISOString();
      const descriptor = dict.get(id);

      expect(descriptor!.firstSeen).toBeDefined();
      expect(descriptor!.firstSeen >= before).toBe(true);
      expect(descriptor!.firstSeen <= after).toBe(true);
    });

    it('should handle effects without metadata', () => {
      const dict = EffectDictionary.getInstance();
      const id = dict.register('particle', 'Test', 'Test'); // No metadata

      const descriptor = dict.get(id);
      expect(descriptor!.metadata).toBeUndefined();
    });

    it('should preserve complex metadata objects', () => {
      const dict = EffectDictionary.getInstance();
      const metadata = {
        color: 'red',
        size: 10,
        nested: {
          value: 42,
        },
        array: [1, 2, 3],
      };

      const id = dict.register('particle', 'Complex', 'Test', metadata);
      const descriptor = dict.get(id);

      expect(descriptor!.metadata).toEqual(metadata);
    });
  });
});
