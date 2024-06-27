using Microsoft.AspNetCore.Mvc;

namespace Coup.Controllers
{
    public class CoupController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
