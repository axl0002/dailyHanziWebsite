export const dynamic = 'force-static';

export function GET() {
  return Response.json({
    applinks: {
      details: [{
        appIDs: ['MK29ZT8FZ7.com.alexliu.dailyhanzi'],
        components: [{ '/': '/add/*' }],
      }],
    },
  });
}
