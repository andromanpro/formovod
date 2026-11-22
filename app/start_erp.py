"""Open Formovod and let the operator choose a web publication."""
import sys

if __name__ == '__main__':
    if '--check' in sys.argv[1:] or '--print-mcp' in sys.argv[1:]:
        from first_run import main
        raise SystemExit(main())
    from visual_mcp import main
    sys.argv[1:1] = ['--panel','--interactive']
    main()
