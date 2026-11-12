from django.core.management.base import BaseCommand
from crawler.models import DorkQuery
from crawler.crawler_engine import GoogleDorkCrawler

class Command(BaseCommand):
    help = 'Crawl Google with dork queries'

    def add_arguments(self, parser):
        parser.add_argument(
            '--query',
            type=str,
            help='Specific dork query to crawl',
        )
        parser.add_argument(
            '--pages',
            type=int,
            default=10,
            help='Maximum number of pages to crawl (default: 10)',
        )
        parser.add_argument(
            '--all',
            action='store_true',
            help='Crawl all active dork queries',
        )
        parser.add_argument(
            '--headless',
            action='store_true',
            default=True,
            help='Run browser in headless mode (default: True)',
        )
        parser.add_argument(
            '--threads',
            type=int,
            default=1,
            help='Number of concurrent threads (default: 1)',
        )
        parser.add_argument(
            '--use-profile',
            action='store_true',
            help='Use existing Chromium profile (disables multi-threading)',
        )

    def handle(self, *args, **options):
        # Check for profile + threads conflict
        if options['use_profile'] and options['threads'] > 1:
            self.stdout.write(self.style.ERROR('Cannot use --use-profile with multiple threads'))
            self.stdout.write('Using --threads=1')
            options['threads'] = 1
        
        crawler = GoogleDorkCrawler(
            headless=options['headless'],
            use_profile=options['use_profile']
        )
        
        if options['headless']:
            self.stdout.write(self.style.WARNING('Running in headless mode'))
        if options['threads'] > 1:
            self.stdout.write(self.style.WARNING(f'Using {options["threads"]} threads'))
        
        try:
            if options['query']:
                # Crawl specific query
                dork_query, created = DorkQuery.objects.get_or_create(
                    query=options['query']
                )
                if created:
                    self.stdout.write(self.style.SUCCESS(f'Created new dork query: {options["query"]}'))
                
                self.stdout.write(self.style.SUCCESS(f'Starting crawl for: {dork_query.query}'))
                results = crawler.search_google(dork_query, max_pages=options['pages'], threads=options['threads'])
                self.stdout.write(self.style.SUCCESS(f'Crawled {len(results)} new links'))
                
            elif options['all']:
                # Crawl all active queries
                dork_queries = DorkQuery.objects.filter(is_active=True)
          
                if not dork_queries.exists():
                    self.stdout.write(self.style.WARNING('No active dork queries found'))
                    return
                
                for dork_query in dork_queries:
                    self.stdout.write(self.style.SUCCESS(f'Starting crawl for: {dork_query.query}'))
                    results = crawler.search_google(dork_query, max_pages=options['pages'], threads=options['threads'])
                    self.stdout.write(self.style.SUCCESS(f'Crawled {len(results)} new links'))
                    
                    # Delay between different queries
                    import time
                    time.sleep(30)
            else:
                self.stdout.write(self.style.ERROR('Please specify --query or --all'))
                
        finally:
            crawler.close()
