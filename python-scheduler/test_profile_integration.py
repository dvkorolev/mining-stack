#!/usr/bin/env python3
"""
Test script for ASIC Profile Library integration
Run this to verify the integration is working correctly
"""

import sys
from asic_profile_loader import get_library
from parsers.cgminer_parser import _detect_actual_units
from collectors.pyasic_collector import _is_scrypt_miner

def test_profile_library_loading():
    """Test that profile library loads successfully"""
    print("=" * 60)
    print("TEST 1: Profile Library Loading")
    print("=" * 60)
    
    try:
        library = get_library()
        stats = library.get_stats()
        
        print(f"✓ Profile library loaded successfully")
        print(f"  Total profiles: {stats['total_profiles']}")
        print(f"  SHA-256 miners: {stats['algorithms']['sha256']}")
        print(f"  SCRYPT miners: {stats['algorithms']['scrypt']}")
        print(f"  Manufacturers: {', '.join(stats['manufacturers'])}")
        print(f"  Exact matches: {stats['exact_matches']}")
        print(f"  Pattern matches: {stats['pattern_matches']}")
        return True
    except Exception as e:
        print(f"✗ Failed to load profile library: {e}")
        return False


def test_profile_matching():
    """Test profile matching for various miner models"""
    print("\n" + "=" * 60)
    print("TEST 2: Profile Matching")
    print("=" * 60)
    
    library = get_library()
    
    test_cases = [
        # (model, expected_profile_id, expected_algorithm)
        ("Whatsminer M50S++", "whatsminer_m50s", "sha256"),
        ("Whatsminer M50S VL30", "whatsminer_m50s", "sha256"),
        ("Whatsminer M30S+", "whatsminer_m30s", "sha256"),
        ("Antminer S19 Pro", "antminer_s19", "sha256"),
        ("Antminer S19j Pro", "antminer_s19", "sha256"),
        ("Antminer S17", "antminer_s17", "sha256"),
        ("ElphaPex DG1", "elphapex_dg1", "scrypt"),
        ("DG1", "elphapex_dg1", "scrypt"),
        ("Antminer L7", "antminer_l7", "scrypt"),
        ("Antminer L3+", "antminer_l3", "scrypt"),
        ("Unknown Miner X1000", None, None),  # Should not match
    ]
    
    passed = 0
    failed = 0
    
    for model, expected_id, expected_algo in test_cases:
        profile = library.get_profile(model)
        
        if expected_id is None:
            # Should not match
            if profile is None:
                print(f"✓ {model:30} -> No match (expected)")
                passed += 1
            else:
                print(f"✗ {model:30} -> Matched {profile.id} (unexpected)")
                failed += 1
        else:
            # Should match
            if profile and profile.id == expected_id and profile.algorithm == expected_algo:
                print(f"✓ {model:30} -> {profile.id} ({profile.algorithm})")
                passed += 1
            elif profile:
                print(f"✗ {model:30} -> {profile.id} (expected {expected_id})")
                failed += 1
            else:
                print(f"✗ {model:30} -> No match (expected {expected_id})")
                failed += 1
    
    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


def test_algorithm_detection():
    """Test SCRYPT vs SHA-256 algorithm detection"""
    print("\n" + "=" * 60)
    print("TEST 3: Algorithm Detection")
    print("=" * 60)
    
    test_cases = [
        ("Whatsminer M50S", False),  # SHA-256
        ("Antminer S19", False),     # SHA-256
        ("DG1", True),               # SCRYPT
        ("Antminer L7", True),       # SCRYPT
        ("Antminer L3+", True),      # SCRYPT
    ]
    
    passed = 0
    failed = 0
    
    for model, expected_scrypt in test_cases:
        is_scrypt = _is_scrypt_miner(model)
        algo_name = "SCRYPT" if is_scrypt else "SHA-256"
        expected_name = "SCRYPT" if expected_scrypt else "SHA-256"
        
        if is_scrypt == expected_scrypt:
            print(f"✓ {model:30} -> {algo_name}")
            passed += 1
        else:
            print(f"✗ {model:30} -> {algo_name} (expected {expected_name})")
            failed += 1
    
    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


def test_unit_detection():
    """Test hashrate unit detection with profiles"""
    print("\n" + "=" * 60)
    print("TEST 4: Hashrate Unit Detection")
    print("=" * 60)
    
    library = get_library()
    
    test_cases = [
        # (model, raw_value, field_name, expected_ths, expected_unit_contains)
        ("Whatsminer M50S", 120.5, "MHS av", 120.5, "TH/s"),
        ("Antminer S19", 110.0, "MHS av", 110.0, "TH/s"),
        ("DG1", 14000.0, "MHS av", 14.0, "GH/s"),  # 14000 MH/s = 14 GH/s = 0.014 TH/s
        ("Antminer L7", 9500.0, "MHS av", 9.5, "GH/s"),
    ]
    
    passed = 0
    failed = 0
    
    for model, raw_value, field_name, expected_ths, expected_unit in test_cases:
        profile = library.get_profile(model)
        hashrate_ths, detected_unit = _detect_actual_units(model, raw_value, field_name, profile)
        
        # Allow small floating point differences
        if abs(hashrate_ths - expected_ths) < 0.01 and expected_unit in detected_unit:
            print(f"✓ {model:20} {raw_value:8.1f} -> {hashrate_ths:8.3f} TH/s ({detected_unit})")
            passed += 1
        else:
            print(f"✗ {model:20} {raw_value:8.1f} -> {hashrate_ths:8.3f} TH/s (expected {expected_ths})")
            print(f"  Detected unit: {detected_unit}")
            failed += 1
    
    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


def test_driver_priorities():
    """Test that profiles have correct driver priorities"""
    print("\n" + "=" * 60)
    print("TEST 5: Driver Priorities")
    print("=" * 60)
    
    library = get_library()
    
    test_cases = [
        ("Whatsminer M50S", ["pyasic", "cgminer"]),
        ("Antminer S19", ["pyasic", "cgminer", "antminer_cgi"]),
        ("DG1", ["dg1_tcp", "cgminer"]),
    ]
    
    passed = 0
    failed = 0
    
    for model, expected_drivers in test_cases:
        profile = library.get_profile(model)
        
        if not profile:
            print(f"✗ {model:30} -> No profile found")
            failed += 1
            continue
        
        drivers = profile.get_ordered_drivers()
        driver_types = [d.get('type') for d in drivers]
        
        if driver_types == expected_drivers:
            print(f"✓ {model:30} -> {', '.join(driver_types)}")
            passed += 1
        else:
            print(f"✗ {model:30} -> {', '.join(driver_types)}")
            print(f"  Expected: {', '.join(expected_drivers)}")
            failed += 1
    
    print(f"\nResults: {passed} passed, {failed} failed")
    return failed == 0


def main():
    """Run all tests"""
    print("\n" + "=" * 60)
    print("ASIC PROFILE LIBRARY INTEGRATION TESTS")
    print("=" * 60 + "\n")
    
    results = []
    
    # Run tests
    results.append(("Profile Library Loading", test_profile_library_loading()))
    results.append(("Profile Matching", test_profile_matching()))
    results.append(("Algorithm Detection", test_algorithm_detection()))
    results.append(("Unit Detection", test_unit_detection()))
    results.append(("Driver Priorities", test_driver_priorities()))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for test_name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status:8} {test_name}")
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! Integration is working correctly.")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Please review the output above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
